package com.showcase.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

@Composable
internal fun ConfigurationCodeView(controller: PlayerController, uiMode: UiMode) {
    var expanded by remember { mutableStateOf(false) }
    Button(onClick = { expanded = !expanded }, modifier = Modifier.testTag("configuration-code-toggle")) {
        Text(if (expanded) "Hide applied code" else "Show applied code")
    }
    if (!expanded) return
    val code = remember(controller.sourceRevision, controller.playerSettings, uiMode) {
        configurationCode(controller.sourceSettings, controller.playerSettings, uiMode)
    }
    var copied by remember(code) { mutableStateOf(false) }
    val clipboard = LocalContext.current.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    Text("Player, source and UI settings sent to the SDK. Draft edits are excluded and license keys use placeholders.", style = MaterialTheme.typography.bodySmall)
    Button(onClick = {
        clipboard?.setPrimaryClip(ClipData.newPlainText("Player configuration", code))
        copied = true
    }, enabled = clipboard != null, modifier = Modifier.testTag("configuration-code-copy")) {
        Text(if (copied) "Copied" else "Copy code")
    }
    SelectionContainer {
        Column(Modifier.heightIn(max = 260.dp).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState())) {
            Text(code, fontFamily = FontFamily.Monospace, softWrap = false,
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("configuration-code-text"))
        }
    }
}
