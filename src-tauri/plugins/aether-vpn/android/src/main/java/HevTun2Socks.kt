package com.cluvexstudio.aethergui.vpn

/**
 * Thin JNI bridge to the pinned hev-socks5-tunnel native library.
 *
 * The native library registers these methods from JNI_OnLoad using this exact
 * package and class name. Keep the names and signatures in sync with the
 * workflow's PKGNAME/CLSNAME build defines.
 */
class HevTun2Socks {
    external fun TProxyStartService(configPath: String, tunFd: Int)
    external fun TProxyStopService()
    external fun TProxyGetStats(): LongArray

    companion object {
        init {
            System.loadLibrary("hev-socks5-tunnel")
        }
    }
}
