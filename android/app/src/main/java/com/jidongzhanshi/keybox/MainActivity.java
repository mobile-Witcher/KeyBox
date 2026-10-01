package com.jidongzhanshi.keybox;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 安装证书白名单校验的 WebViewClient：修复华为 WebView 对腾讯云
        // CDN/多域名证书误报「名称不一致」导致的启动证书警告弹窗。
        getBridge().getWebView().setWebViewClient(new SecurityWebViewClient(getBridge()));
    }
}
