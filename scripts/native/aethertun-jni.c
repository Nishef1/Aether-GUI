/*
 * Stable JNI bridge for hev-socks5-tunnel.
 *
 * Copyright (C) 2026 Aether-GUI contributors.
 * Architecture informed by QW-AI-Code/Aether's AGPL-3.0 Android bridge.
 * This file is distributed under the repository's AGPL-3.0 license.
 *
 * The bundled hev JNI layer is intentionally excluded from the Android build.
 * We bind only hev's stable public C API and run its blocking event loop on a
 * native pthread. The thread is JOINABLE: Java must not close the VPN descriptor
 * while hev is still reading it, and a timed-out detached teardown can corrupt
 * a later session or crash the process during Disconnect.
 */

#include <android/log.h>
#include <errno.h>
#include <jni.h>
#include <pthread.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern int hev_socks5_tunnel_main(const char *config_path, int tun_fd);
extern void hev_socks5_tunnel_quit(void);
extern void hev_socks5_tunnel_stats(size_t *tx_packets, size_t *tx_bytes,
                                     size_t *rx_packets, size_t *rx_bytes);

#define TAG "aethertun"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

typedef enum {
    TUN_STATE_STOPPED = 0,
    TUN_STATE_STARTING,
    TUN_STATE_RUNNING,
    TUN_STATE_STOPPING,
} TunnelState;

typedef struct {
    char *config_path;
    int tun_fd;
} StartArgs;

static pthread_mutex_t state_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t state_changed = PTHREAD_COND_INITIALIZER;
static TunnelState state = TUN_STATE_STOPPED;
static pthread_t tunnel_thread_handle;
static bool thread_joinable = false;
static bool join_in_progress = false;
static bool quit_requested = false;

static void *tunnel_thread(void *opaque)
{
    StartArgs *args = (StartArgs *)opaque;

    pthread_mutex_lock(&state_lock);
    if (state == TUN_STATE_STARTING)
        state = TUN_STATE_RUNNING;
    pthread_cond_broadcast(&state_changed);
    pthread_mutex_unlock(&state_lock);

    LOGI("native tunnel thread started (fd=%d)", args->tun_fd);
    const int result = hev_socks5_tunnel_main(args->config_path, args->tun_fd);
    LOGI("native tunnel loop exited with code %d", result);

    /* The bridge owns this duplicate. hev treats external descriptors as
     * caller-owned and never closes them. */
    close(args->tun_fd);
    free(args->config_path);
    free(args);

    pthread_mutex_lock(&state_lock);
    state = TUN_STATE_STOPPED;
    pthread_cond_broadcast(&state_changed);
    pthread_mutex_unlock(&state_lock);
    return NULL;
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved)
{
    (void)vm;
    (void)reserved;
    LOGI("stable joinable Aether TUN bridge loaded");
    return JNI_VERSION_1_6;
}

JNIEXPORT jboolean JNICALL
Java_com_cluvexstudio_aethergui_vpn_AetherTunBridge_nativeStart(
    JNIEnv *env, jobject instance, jstring config_path, jint tun_fd)
{
    (void)instance;

    pthread_mutex_lock(&state_lock);
    if (thread_joinable || state != TUN_STATE_STOPPED) {
        pthread_mutex_unlock(&state_lock);
        LOGW("start rejected because the previous native tunnel is not fully joined");
        return JNI_FALSE;
    }
    state = TUN_STATE_STARTING;
    quit_requested = false;
    pthread_mutex_unlock(&state_lock);

    const char *path = (*env)->GetStringUTFChars(env, config_path, NULL);
    if (path == NULL)
        goto fail;

    StartArgs *args = (StartArgs *)calloc(1, sizeof(StartArgs));
    if (args == NULL) {
        (*env)->ReleaseStringUTFChars(env, config_path, path);
        goto fail;
    }

    args->config_path = strdup(path);
    (*env)->ReleaseStringUTFChars(env, config_path, path);
    if (args->config_path == NULL) {
        free(args);
        goto fail;
    }

    args->tun_fd = dup((int)tun_fd);
    if (args->tun_fd < 0) {
        LOGE("dup(tun_fd) failed: errno=%d", errno);
        free(args->config_path);
        free(args);
        goto fail;
    }

    pthread_t thread;
    const int rc = pthread_create(&thread, NULL, tunnel_thread, args);
    if (rc != 0) {
        LOGE("pthread_create failed: %d", rc);
        close(args->tun_fd);
        free(args->config_path);
        free(args);
        goto fail;
    }

    pthread_mutex_lock(&state_lock);
    tunnel_thread_handle = thread;
    thread_joinable = true;
    pthread_cond_broadcast(&state_changed);
    pthread_mutex_unlock(&state_lock);
    return JNI_TRUE;

fail:
    pthread_mutex_lock(&state_lock);
    state = TUN_STATE_STOPPED;
    quit_requested = false;
    pthread_cond_broadcast(&state_changed);
    pthread_mutex_unlock(&state_lock);
    return JNI_FALSE;
}

JNIEXPORT jboolean JNICALL
Java_com_cluvexstudio_aethergui_vpn_AetherTunBridge_nativeStop(
    JNIEnv *env, jobject instance)
{
    (void)env;
    (void)instance;

    pthread_t thread;
    bool should_request_quit = false;

    pthread_mutex_lock(&state_lock);
    while (join_in_progress)
        pthread_cond_wait(&state_changed, &state_lock);

    if (!thread_joinable) {
        state = TUN_STATE_STOPPED;
        pthread_mutex_unlock(&state_lock);
        return JNI_TRUE;
    }

    join_in_progress = true;
    thread = tunnel_thread_handle;
    if (state != TUN_STATE_STOPPED && !quit_requested) {
        state = TUN_STATE_STOPPING;
        quit_requested = true;
        should_request_quit = true;
    }
    pthread_mutex_unlock(&state_lock);

    if (should_request_quit) {
        LOGI("requesting native tunnel stop");
        hev_socks5_tunnel_quit();
    }

    const int join_result = pthread_join(thread, NULL);

    pthread_mutex_lock(&state_lock);
    thread_joinable = false;
    join_in_progress = false;
    quit_requested = false;
    state = TUN_STATE_STOPPED;
    pthread_cond_broadcast(&state_changed);
    pthread_mutex_unlock(&state_lock);

    if (join_result != 0) {
        LOGE("pthread_join failed: %d", join_result);
        return JNI_FALSE;
    }
    LOGI("native tunnel thread joined");
    return JNI_TRUE;
}

JNIEXPORT jlongArray JNICALL
Java_com_cluvexstudio_aethergui_vpn_AetherTunBridge_nativeStats(
    JNIEnv *env, jobject instance)
{
    (void)instance;

    pthread_mutex_lock(&state_lock);
    const bool active = state == TUN_STATE_RUNNING || state == TUN_STATE_STOPPING;
    pthread_mutex_unlock(&state_lock);
    if (!active)
        return NULL;

    size_t tx_packets = 0;
    size_t tx_bytes = 0;
    size_t rx_packets = 0;
    size_t rx_bytes = 0;
    hev_socks5_tunnel_stats(&tx_packets, &tx_bytes, &rx_packets, &rx_bytes);

    const jlong values[4] = {
        (jlong)tx_packets,
        (jlong)tx_bytes,
        (jlong)rx_packets,
        (jlong)rx_bytes,
    };
    jlongArray result = (*env)->NewLongArray(env, 4);
    if (result == NULL)
        return NULL;
    (*env)->SetLongArrayRegion(env, result, 0, 4, values);
    return result;
}
