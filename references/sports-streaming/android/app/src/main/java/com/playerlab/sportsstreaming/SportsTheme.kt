package com.playerlab.sportsstreaming

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val SportsColors = lightColorScheme(
    primary = Color(0xFF196E91), onPrimary = Color.White,
    primaryContainer = Color(0xFFDCECF3), onPrimaryContainer = Color(0xFF163B50),
    background = Color(0xFFF5F8FA), onBackground = Color(0xFF193244),
    surface = Color.White, onSurface = Color(0xFF193244),
    surfaceVariant = Color(0xFFE8EFF3), onSurfaceVariant = Color(0xFF506979),
    outline = Color(0xFF758B9A), outlineVariant = Color(0xFFD8E3EB),
    error = Color(0xFFA9381B),
)
@Composable fun SportsTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = SportsColors, content = content)
}
