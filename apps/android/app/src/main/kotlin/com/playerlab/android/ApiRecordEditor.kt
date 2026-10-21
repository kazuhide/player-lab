package com.playerlab.android

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/** A field-by-field editor. SDK objects are built only after full schema validation. */
@Composable
internal fun ApiRecordEditor(schema: ApiRecordSchema, value: String, changed: (String) -> Unit, path: String = "record") {
    val records = remember(value) { ApiRecordValues.decode(value) }
    Text(schema.label, style = MaterialTheme.typography.titleSmall)
    records.forEachIndexed { index, record ->
        Column(Modifier.padding(start = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("${schema.label} ${index + 1}")
            schema.fields.forEach { field ->
                val tag = "$path-$index-${field.name}"
                fun update(input: String) = changed(ApiRecordValues.encode(records.mapIndexed { i, item -> if (i == index) item + (field.name to input) else item }))
                if (field.nested != null) {
                    var open by remember(path, index, field.name) { mutableStateOf(false) }
                    Button(onClick = { open = !open }, modifier = Modifier.testTag("$tag-toggle")) { Text(if (open) "Hide ${field.name}" else "Edit ${field.name}") }
                    if (open) ApiRecordEditor(field.nested, record.getValue(field.name), ::update, tag)
                } else {
                    OutlinedTextField(record.getValue(field.name), ::update, label = { Text(field.name + if (field.nullable) " (null allowed)" else "") },
                        modifier = Modifier.fillMaxWidth().testTag(tag), singleLine = true)
                    (field.choices + if (field.nullable) listOf("null") else emptyList()).forEach { choice ->
                        Button(onClick = { update(choice) }, modifier = Modifier.testTag("$tag-$choice")) { Text(choice) }
                    }
                }
            }
            Button(onClick = { changed(ApiRecordValues.encode(records.filterIndexed { i, _ -> i != index })) }, modifier = Modifier.testTag("$path-$index-remove")) { Text("Remove item") }
        }
    }
    Button(onClick = { changed(ApiRecordValues.encode(records + schema.defaults(records.size))) }, enabled = records.size < schema.maximumItems,
        modifier = Modifier.testTag("$path-add")) { Text("Add ${schema.label}") }
    Text("${records.size} item(s). Changes remain a draft until staged and applied.", style = MaterialTheme.typography.bodySmall)
}
