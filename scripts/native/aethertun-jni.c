/*
 * Stable JNI bridge for hev-socks5-tunnel.
 *
 * Copyright (C) 2026 Aether-GUI contributors.
 * Architecture informed by QW-AI-Code/Aether's AGPL-3.0 Android bridge.
 * This file is distributed under the repository's AGPL-3.0 license.
 *
 * The bundled hev JNI layer is intentionally excluded from the Android build.
 * We bind only hev's stable public C API and run its blocking event loop on a
 * detached native pthread. Running hev's stack-switching task system directly
 * on an ART-managed Java thread can corrupt ART's stack assumptions and crash
 * the process during traffic or teardown.
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
#include <time.h>
#include <unistd.h>

extern int hev_socks5_tunnel_main(const char *config_path, int tun_fd);
extern void hev_socks5_tunnel_quit(void);
extern void hev_socks5_tunnel_stats(size_t *tx_packets, size_t *tx_bytes,
                                    size_t *rx_packets, size_t *rx_bytes);

#define TAG "aethertun"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)
#define STOP_WAIT_MS 3000L

static pthread_mutex_t state_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t state_changed = PTHREAD_COND_INITIALIZER;
static bool running = false;

typedef struct {
    char *config_path;
    int tun_fd;
} StartArgs;

static void add_milliseconds(struct timespec *value, long milliseconds)
{
    value->tv_sec += milliseconds / 1000L;
    value->tv_nsec += (milliseconds % 1000L) * 1000000L;
    if (value->tv_nsec >= 1000000000L) {
        value->tv_sec += 1;
        value->tv_nsec -= 1000000000L;
    }
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved)
{
    (void)vm;
    (void)reserved;
    LOGI("stable Aether TUN bridge loaded");
    return JNI_VERSION_1_6;
}

static void *tunnel_thread(void *opaque)
{
    StartArgs *args = (StartArgs *)opaque;
    const int result = hev_socks5_tunnel_main(args->config_path, args->tun_fd);

    close(args->tun_fd);
    free(args->config_path);
    free(args);

    pthread_mutex_lock(&state_lock);
    running = false;
    pthread_cond_broadcast(&state_changed);
    pthread_mutex_unlock(&state_lock);

    LOGI("native tunnel thread exited with code %d", result);
    return NULL;
}

JNIEXPORT jboolean JNICALL
Java_com_cluvexstudio_aethergui_vpn_AetherTunBridge_nativeStart(
    JNIEnv *env, jobject instance, jstring config_path, jint tun_fd)
{
    (void)instance;

    pthread_mutex_lock(&state_lock);
    if (running) {
        pthread_mutex_unlock(&state_lock);
        LOGW("start rejected because a native tunnel is already running");
        return JNI_FALSE;
    }
    running = true;
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

    /* Own a duplicate so Java can close its ParcelFileDescriptor only after
     * the native loop has acknowledged quit without racing the same fd. */
    args->tun_fd = dup((int)tun_fd);
    if (args->tun_fd < 0) {
        LOGE("dup(tun_fd) failed: errno=%d", errno);
        free(args->config_path);
        free(args);
        goto fail;
    }

    pthread_attr_t attributes;
    pthread_t thread;
    pthread_attr_init(&attributes);
    pthread_attr_setdetachstate(&attributes, PTHREAD_CREATE_DETACHED);
    const int rc = pthread_create(&thread, &attributes, tunnel_thread, args);
    pthread_attr_destroy(&attributes);
    if (rc != 0) {
        LOGE("pthread_create failed: %d", rc);
        close(args->tun_fd);
        free(args->config_path);
        free(args);
        goto fail;
    }

    LOGI("native tunnel thread started");
    return JNI_TRUE;

fail:
    pthread_mutex_lock(&state_lock);
    running = false;
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

    pthread_mutex_lock(&state_lock);
    const bool was_running = running;
    pthread_mutex_unlock(&state_lock);
    if (!was_running)
        return JNI_TRUE;

    hev_socks5_tunnel_quit();

    struct timespec deadline;
    clock_gettime(CLOCK_REALTIME, &deadline);
    add_milliseconds(&deadline, STOP_WAIT_MS);

    pthread_mutex_lock(&state_lock);
    while (running) {
        const int rc = pthread_cond_timedwait(&state_changed, &state_lock, &deadline);
        if (rc == ETIMEDOUT)
            break;
    }
    const bool stopped = !running;
    pthread_mutex_unlock(&state_lock);

    if (!stopped)
        LOGE("native tunnel did not stop within %ld ms", STOP_WAIT_MS);
    return stopped ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jlongArray JNICALL
Java_com_cluvexstudio_aethergui_vpn_AetherTunBridge_nativeStats(
    JNIEnv *env, jobject instance)
{
    (void)instance;

    pthread_mutex_lock(&state_lock);
    const bool active = running;
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
