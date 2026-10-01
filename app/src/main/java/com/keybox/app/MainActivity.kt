package com.keybox.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.keybox.app.ui.KeyBoxApp
import com.keybox.app.ui.theme.KeyBoxTheme

class MainActivity : ComponentActivity() {

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
