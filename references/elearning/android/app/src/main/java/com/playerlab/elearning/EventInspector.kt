package com.playerlab.elearning

import android.app.AlertDialog
import android.content.Context
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.ListView

class EventInspector(context: Context, private val session: PlaybackSession) {
    private val summary = context.label(size = 14f)
    private val adapter = ArrayAdapter<String>(context, android.R.layout.simple_list_item_1)
    private val dialog = AlertDialog.Builder(context).setTitle(R.string.diagnostics)
        .setView(context.column().apply {
            setPadding(context.dp(16), context.dp(8), context.dp(16), 0)
            addView(summary)
            addView(ListView(context).apply { this.adapter = this@EventInspector.adapter }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, context.dp(300)))
        }).setNegativeButton(R.string.close, null)
        .setNeutralButton(R.string.clear) { _, _ -> session.diagnostics.clear() }.create()
    private var lastEntries = emptyList<DiagnosticEntry>()
    fun show() { dialog.show(); update() }
    fun dismiss() = dialog.dismiss()
    fun update() {
        if (!dialog.isShowing) return
        val state = session.snapshot(0, 0)
        summary.text = "${session.learner.name}  ${session.activeItem?.lesson?.id.orEmpty()}\n${formatTime(session.positionMs)} / ${formatTime((state.duration.takeIf { it.isFinite() } ?: 0.0).times(1000).toLong())}\n${state.speed}×  ${state.subtitleId ?: "off"}  ${session.uiMode.name.lowercase()}"
        val entries = session.diagnostics.entries()
        if (entries == lastEntries) return
        lastEntries = entries
        adapter.clear()
        adapter.addAll(entries.asReversed().map { "${formatTime(it.positionMs)}  ${it.kind.name}${it.sdkCode?.let { code -> "  SDK $code" }.orEmpty()}${it.httpStatus?.let { code -> "  HTTP $code" }.orEmpty()}\n${it.lessonId.orEmpty()}  ${it.uiMode.name.lowercase()}" })
    }
}
