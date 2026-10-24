package com.playerlab.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** Structured values use the same focused item/property pattern, including nested records. */
@Composable
internal fun ApiRecordEditor(schema: ApiRecordSchema, value: String, changed: (String) -> Unit,
    path: String = "record", buttonTag: String = "$path-open") {
    var open by remember(schema, path) { mutableStateOf(false) }
    var index by remember(schema, path) { mutableStateOf(0) }
    var property by remember(schema, path) { mutableStateOf(schema.fields.first().name) }
    val records = remember(value) { ApiRecordValues.decode(value) }
    OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth().testTag(buttonTag)) {
        UiText(uiFormat(R.string.ui_edit_records, uiText(schema.label), records.size))
    }
    if (!open) return
    Dialog(onDismissRequest = { open = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth().fillMaxHeight(0.92f).padding(12.dp), shape = MaterialTheme.shapes.medium) {
            Column(Modifier.fillMaxSize()) {
                WorkspaceHeader(!workspaceKeyboardEditing()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    WorkspaceHeading(schema.label)
                    if (records.isNotEmpty()) {
                        WorkspacePicker("Item", index.coerceAtMost(records.lastIndex), records.indices.map { it to uiFormat(R.string.ui_record_item, it + 1) }, "$path-item", compact = true) { index = it }
                        WorkspacePicker("Property", property, schema.fields.map { it.name to it.name }, "$path-property", searchable = true, compact = true) { property = it }
                    }
                } }
                Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (records.isEmpty()) UiText("Add an item to edit its properties.")
                    else {
                        val selected = index.coerceAtMost(records.lastIndex)
                        val record = records[selected]
                        val field = schema.fields.first { it.name == property }
                        val tag = "$path-$selected-${field.name}"
                        fun update(input: String) = changed(ApiRecordValues.encode(records.mapIndexed { i, item -> if (i == selected) item + (field.name to input) else item }))
                        if (field.nested != null) ApiRecordEditor(field.nested, record.getValue(field.name), ::update, tag, "$tag-toggle")
                        else if (field.choices.isNotEmpty()) WorkspacePicker(field.name, record.getValue(field.name),
                            (field.choices + if (field.nullable) listOf("null") else emptyList()).map { it to it }, "$tag-choice") { update(it) }
                        else ConfigField(if (field.nullable) uiFormat(R.string.ui_nullable_property, field.name) else field.name, record.getValue(field.name), ::update, tag,
                            helper = if (field.nullable) "Enter null to use the SDK null value." else "")
                    }
                    UiText("Edits remain in the SDK field draft. Close this editor, then Stage override and Apply SDK.", style = MaterialTheme.typography.bodySmall)
                }
                Surface(tonalElevation = 2.dp) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            OutlinedButton(onClick = {
                                changed(ApiRecordValues.encode(records + schema.defaults(records.size))); index = records.size
                            }, enabled = records.size < schema.maximumItems, modifier = Modifier.testTag("$path-add")) { UiText("Add item") }
                            OutlinedButton(onClick = {
                                val selected = index.coerceAtMost(records.lastIndex)
                                changed(ApiRecordValues.encode(records.filterIndexed { i, _ -> i != selected })); index = (selected - 1).coerceAtLeast(0)
                            }, enabled = records.isNotEmpty(), modifier = Modifier.testTag("$path-${index.coerceAtMost(records.lastIndex)}-remove")) { UiText("Remove item") }
                        }
                        Button(onClick = { open = false }, modifier = Modifier.fillMaxWidth().testTag("$path-close")) { UiText("Close editor") }
                    }
                }
            }
        }
    }
}
