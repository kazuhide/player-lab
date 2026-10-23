package com.playerlab.android

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import com.bitmovin.player.api.DebugConfig

@Composable
internal fun ApiStartupPanel(controller: PlayerController) {
    var saved by remember { mutableStateOf(ApiStartupSettings.read(controller.hostContext)) }
    var enabled by remember { mutableStateOf(saved) }
    var result by remember { mutableStateOf("") }
    Text("DebugConfig.isLoggingEnabled (startup setting)", style = MaterialTheme.typography.titleSmall)
    Row { Switch(enabled, { enabled = it }, modifier = Modifier.testTag("api-startup-logging")); Text("Enable global SDK debug logging on the next app launch") }
    Button(onClick = { result = if (ApiStartupSettings.save(controller.hostContext, enabled)) { saved = enabled; "Saved for the next full app launch." } else "The startup option could not be saved." },
        modifier = Modifier.testTag("api-startup-save")) { Text("Save startup setting") }
    Text("Current process: ${DebugConfig.isLoggingEnabled}; saved for next launch: $saved", style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("api-startup-state"))
    if (result.isNotEmpty()) Text(result, style = MaterialTheme.typography.bodySmall)
    Text("This SDK option must be set before any Bitmovin component is created. Save it, then fully stop and reopen this app. The current player is not restarted by this button. SDK debug logs can include confidential data; keep them local and turn logging off after debugging.", style = MaterialTheme.typography.bodySmall)
    SelectionContainer { Text("// In Application.onCreate(), before creating SDK components:\nDebugConfig.isLoggingEnabled = $saved", style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, modifier = Modifier.testTag("api-startup-code")) }
}
