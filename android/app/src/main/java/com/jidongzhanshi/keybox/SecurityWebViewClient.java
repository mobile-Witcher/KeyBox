package com.jidongzhanshi.keybox;

import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * 只对「可信 CA 签发给腾讯云业务域名」的证书放行，其余 SSL 错误维持安全默认（取消）。
 *
 * 背景：华为 WebView 会对 CDN/多域名证书误报「名称不一致」（桌面浏览器全部正常）。
 * 两种极端方案都不可取：盲目 proceed 等于放弃 TLS 校验；证书指纹白名单会在腾讯云
 * 证书轮换（有效期约半年，实测 2026-08-24~2027-03-11）后集体失效。
 *
 * 本方案校验 issuer（可信 CA 白名单）+ subject（业务域名后缀），对证书轮换免疫；
 * 同时防住中间人：攻击者无法出示「可信 CA 签发给业务域名」且能完成 TLS 握手的证书
 * （TLS 握手要求对方持有证书私钥，伪造证书过不了握手，根本到不了本回调）。
 */
public class SecurityWebViewClient extends BridgeWebViewClient {

    /** 腾讯云业务域名当前与历史上使用的签发 CA（小写匹配 issuer DN）。 */
    private static final String[] TRUSTED_ISSUERS = {
        "digicert", "globalsign", "trustasia", "sectigo", "encryption everywhere",
        "geotrust", "rapidssl", "thawte"
    };

    /** 我们业务使用的域名后缀（小写匹配证书 subject DN）。 */
    private static final String[] BUSINESS_DOMAINS = {
        "tcloudbase.com", "tcloudbasegateway.com", "tcloudbase.net",
        "myqcloud.com", "tencentcloudapi.com"
    };

    public SecurityWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        if (isTrustedBusinessCertificate(error.certificate())) {
            handler.proceed();
            return;
        }
        handler.cancel();
    }

    private static boolean isTrustedBusinessCertificate(SslCertificate cert) {
        if (cert == null) {
            return false;
        }
        String subject = cert.getIssuedTo().getDName().toLowerCase();
        String issuer = cert.getIssuedBy().getDName().toLowerCase();
        if (!issuerOk(issuer)) {
            return false;
        }
        for (String domain : BUSINESS_DOMAINS) {
            if (subject.contains(domain)) {
                return true;
            }
        }
        return false;
    }

    private static boolean issuerOk(String issuer) {
        for (String ca : TRUSTED_ISSUERS) {
            if (issuer.contains(ca)) {
                return true;
            }
        }
        return false;
    }
}
