package com.playerlab.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

@Composable
internal fun ConfigurationCodeView(controller: PlayerController, uiMode: UiMode) {
    var section by remember { mutableStateOf("Player, source and UI") }
    var wrap by remember { mutableStateOf(true) }
    val standard = remember(controller.sourceRevision, controller.playerSettings, uiMode) {
        configurationCode(controller.sourceSettings, controller.playerSettings, uiMode)
    }
    val code = if (section == "SDK overrides") controller.apiOverrides.code().ifEmpty { "// No additional SDK overrides." } else standard
    var copied by remember(code) { mutableStateOf(false) }
    val clipboard = LocalContext.current.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    Column(Modifier.fillMaxSize().testTag("configuration-code-panel")) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            WorkspacePicker("Applied code", section,
                listOf("Player, source and UI" to "Player, source and UI", "SDK overrides" to "SDK overrides"), "configuration-code-section") { section = it }
            Text("Only applied settings are exported. Draft edits are excluded and license keys use placeholders.", style = MaterialTheme.typography.bodySmall)
            if (section == "SDK overrides") Text("Assign these values to fresh configuration objects before creating Player, Source and PlayerView. Copy assignments use mutable playerConfig and playerViewConfig variables.", style = MaterialTheme.typography.bodySmall)
            Row {
                FilterChip(wrap, onClick = { wrap = !wrap }, label = { Text("Wrap lines") },
                    leadingIcon = if (wrap) ({ Text("✓") }) else null, modifier = Modifier.testTag("configuration-code-wrap"))
                Spacer(Modifier.weight(1f))
                Button(onClick = { clipboard?.setPrimaryClip(ClipData.newPlainText("Player configuration", code)); copied = true },
                    enabled = clipboard != null, modifier = Modifier.testTag("configuration-code-copy")) { Text(if (copied) "Copied" else "Copy code") }
            }
        }
        SelectionContainer(Modifier.weight(1f).fillMaxWidth()) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .then(if (wrap) Modifier else Modifier.horizontalScroll(rememberScrollState())).padding(12.dp)) {
                Text(code, fontFamily = FontFamily.Monospace, softWrap = wrap,
                    style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag(if (section == "SDK overrides") "api-settings-code" else "configuration-code-text"))
            }
        }
    }
}
