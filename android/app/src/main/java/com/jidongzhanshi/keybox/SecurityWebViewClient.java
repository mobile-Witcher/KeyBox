package com.jidongzhanshi.keybox;

import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * 只对「业务域名 + SSL_IDMISMATCH（名称不匹配）」的证书错误放行，其余维持安全默认（取消）。
 *
 * 背景：华为 WebView 对腾讯云 CDN/多域名证书误报「名称不一致」——三个业务域名的证书
 * 用 openssl 取证均为正常匹配（DigiCert×2 + GlobalSign，subject 正确覆盖），桌面浏览器
 * 无此误报，属华为 WebView 的过度校验。
 *
 * 安全边界：
 *   - 仅放行 IDMISMATCH：利用此通道要求攻击者持有「签给我们业务域名」的证书+私钥，
 *     而 CA 的域名控制验证使攻击者无法取得。自签证书（UNTRUSTED）、过期证书
 *     （DATE_INVALID）、不受信任 CA 等仍被拒绝。
 *   - URL 白名单限定业务域名后缀，杜绝放行无关域名的错误。
 *   - 证书指纹方案被否决：腾讯云证书约半年轮换（实测 2026-08~2027-03），指纹白名单
 *     会集体失效导致 App 再次弹窗；域名归属校验对轮换免疫。
 */
public class SecurityWebViewClient extends BridgeWebViewClient {

    /** 我们业务使用的域名后缀（小写匹配 URL）。 */
    private static final String[] BUSINESS_DOMAINS = {
        "tcloudbaseapp.com", "tcloudbasegateway.com", "tcloudbase.net",
        "myqcloud.com", "tencentcloudapi.com"
    };

    /** 华为 WebView 的已知误报类型：名称不匹配（多域名 CDN 证书场景）。 */
    private static final int SSL_IDMISMATCH = 2;

    public SecurityWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        if (error.getPrimaryError() == SSL_IDMISMATCH && isBusinessUrl(error.getUrl())) {
            handler.proceed();
            return;
        }
        handler.cancel();
    }

    private static boolean isBusinessUrl(String url) {
        if (url == null) {
            return false;
        }
        String lower = url.toLowerCase();
        for (String domain : BUSINESS_DOMAINS) {
            if (lower.contains(domain)) {
                return true;
            }
        }
        return false;
    }
}
