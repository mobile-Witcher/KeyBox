package com.keybox.app

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import com.keybox.app.ui.KeyBoxApp
import com.keybox.app.ui.theme.KeyBoxTheme

// FragmentActivity：androidx.biometric 的 BiometricPrompt 要求宿主为 FragmentActivity
class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KeyBoxTheme {
                KeyBoxApp()
            }
        }
    }
}
