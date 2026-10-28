package com.playerlab.elearning

import android.content.Context
import android.graphics.Color
import android.text.Editable
import android.text.TextWatcher
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.BaseAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.PopupMenu
import android.widget.TextView

class TranscriptPanel(context: Context, private val session: PlaybackSession) : LinearLayout(context) {
    var onSearchFocusChanged: ((Boolean) -> Unit)? = null
    private val query = EditText(context).apply {
        hint = context.getString(R.string.search_transcript)
        setSingleLine(true)
        imeOptions = EditorInfo.IME_ACTION_SEARCH
        minHeight = context.dp(48)
        textSize = 16f
        setPadding(context.dp(12), 0, context.dp(12), 0)
        background = context.rounded(Color.WHITE, LearningColors.border)
    }
    private val follow = CheckBox(context).apply { text = context.getString(R.string.follow_current); minHeight = context.dp(48) }
    private val language = context.action("") { chooseLanguage() }
    private val message = context.label(size = 15f)
    private val adapter = CueAdapter(context)
    private val list = ListView(context).apply { divider = null; this.adapter = this@TranscriptPanel.adapter }
    private var previousKey: List<Any?>? = null
    private var previousActive = emptySet<TranscriptCue>()

    init {
        orientation = VERTICAL
        addView(query, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        addView(context.row().apply { weighted(follow); addView(language) })
        addView(message)
        addView(list, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
        query.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) { session.viewState.query = s?.toString().orEmpty(); update() }
        })
        query.setOnFocusChangeListener { _, focused -> onSearchFocusChanged?.invoke(focused) }
        query.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_SEARCH) { closeSearchKeyboard(); true } else false
        }
        follow.setOnCheckedChangeListener { _, value -> session.viewState.followPlayback = value }
        list.setOnTouchListener { _, event ->
            if (event.action == MotionEvent.ACTION_DOWN) { session.viewState.followPlayback = false; follow.isChecked = false }
            false
        }
        list.setOnItemClickListener { _, _, position, _ -> closeSearchKeyboard(); session.seek(adapter.items[position].startMs) }
    }

    fun update() {
        val state = session.viewState
        if (query.text.toString() != state.query) query.setText(state.query)
        follow.isChecked = state.followPlayback
        language.text = if (state.transcriptLanguage == "ja") "日本語" else "English"
        val key = listOf(session.transcript, state.query, state.transcriptLanguage, session.transcriptLoading, session.transcriptFailed)
        val changedRows = previousKey != key
        if (changedRows) {
            previousKey = key
            adapter.items = session.transcript.search(state.query, state.transcriptLanguage)
        }
        val active = session.transcript.activeAt(session.positionMs, state.transcriptLanguage).toSet()
        if (changedRows || active != previousActive) {
            adapter.active = active
            adapter.notifyDataSetChanged()
            if (state.followPlayback && state.query.isBlank()) {
                val index = adapter.items.indexOfFirst { it in active }
                if (index >= 0) list.smoothScrollToPositionFromTop(index, 0)
            }
            previousActive = active
        }
        val emptyText = when {
            session.transcriptLoading -> R.string.loading
            session.transcriptFailed -> R.string.transcript_error
            state.query.isNotBlank() -> R.string.no_search_results
            else -> R.string.no_transcript
        }
        message.setText(emptyText)
        message.visibility = if (session.transcriptLoading || session.transcriptFailed || adapter.items.isEmpty()) View.VISIBLE else View.GONE
        list.visibility = if (message.visibility == View.VISIBLE) View.GONE else View.VISIBLE
    }

    private fun chooseLanguage() {
        PopupMenu(context, language).apply {
            menu.add("English").setOnMenuItemClickListener { session.viewState.transcriptLanguage = "en"; update(); true }
            menu.add("日本語").setOnMenuItemClickListener { session.viewState.transcriptLanguage = "ja"; update(); true }
            show()
        }
    }
    fun closeSearchKeyboard() {
        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(query.windowToken, 0)
        query.clearFocus()
    }
}

private class CueAdapter(private val context: Context) : BaseAdapter() {
    var items = emptyList<TranscriptCue>()
    var active = emptySet<TranscriptCue>()
    override fun getCount() = items.size
    override fun getItem(position: Int) = items[position]
    override fun getItemId(position: Int) = position.toLong()
    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val row = convertView as? TextView ?: context.label().apply {
            minHeight = context.dp(64)
            setPadding(context.dp(12), context.dp(12), context.dp(12), context.dp(12))
        }
        val cue = items[position]
        row.text = "${formatTime(cue.startMs)}  ${cue.text}"
        row.isSelected = cue in active
        row.setBackgroundColor(if (row.isSelected) LearningColors.selected else Color.TRANSPARENT)
        row.contentDescription = row.text.toString() + if (row.isSelected) ", " + context.getString(R.string.current_line) else ""
        return row
    }
}
