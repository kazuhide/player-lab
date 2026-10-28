package com.playerlab.elearning

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.StateListDrawable
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ImageButton
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.os.ConfigurationCompat
import java.util.Locale

object LearningColors {
    val background = Color.rgb(244, 247, 250)
    val ink = Color.rgb(29, 52, 69)
    val muted = Color.rgb(80, 103, 119)
    val primary = Color.rgb(23, 110, 145)
    val border = Color.rgb(216, 227, 236)
    val selected = Color.rgb(229, 242, 247)
    val error = Color.rgb(160, 41, 38)
}

fun Context.dp(value: Int) = (value * resources.displayMetrics.density).toInt()
fun Context.column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
fun Context.row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
fun Context.label(text: CharSequence = "", size: Float = 16f, strong: Boolean = false) = TextView(this).apply {
    this.text = text
    textSize = size
    setTextColor(LearningColors.ink)
    if (strong) setTypeface(typeface, Typeface.BOLD)
    setPadding(0, dp(4), 0, dp(4))
}
fun Context.heading(text: CharSequence, size: Float = 20f) = label(text, size, true).apply { ViewCompat.setAccessibilityHeading(this, true) }
fun Context.action(text: CharSequence, primary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
    this.text = text
    textSize = 15f
    isAllCaps = false
    minWidth = 0
    minHeight = dp(48)
    minimumHeight = dp(48)
    stateListAnimator = null
    setPadding(dp(12), dp(8), dp(12), dp(8))
    setTextColor(ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()), intArrayOf(LearningColors.muted, if (primary) Color.WHITE else LearningColors.ink)))
    val states = StateListDrawable().apply {
        addState(intArrayOf(-android.R.attr.state_enabled), rounded(Color.rgb(232, 237, 242), LearningColors.border))
        addState(intArrayOf(android.R.attr.state_focused), rounded(if (primary) LearningColors.primary else LearningColors.selected, LearningColors.primary, 2))
        addState(intArrayOf(), rounded(if (primary) LearningColors.primary else Color.WHITE, LearningColors.border))
    }
    background = RippleDrawable(ColorStateList.valueOf(Color.argb(50, 23, 110, 145)), states, rounded(Color.WHITE))
    setOnClickListener { onClick() }
}
fun Context.rounded(fill: Int, stroke: Int = fill, strokeWidth: Int = 1) = GradientDrawable().apply {
    setColor(fill)
    cornerRadius = dp(6).toFloat()
    setStroke(dp(strokeWidth), stroke)
}
fun LinearLayout.weighted(view: View, weight: Float = 1f) = addView(view, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, weight).apply {
    marginEnd = context.dp(4)
})
fun Context.iconAction(icon: Int, description: Int, onClick: () -> Unit) = ImageButton(this).apply {
    setImageResource(icon)
    contentDescription = getString(description)
    imageTintList = ColorStateList.valueOf(LearningColors.ink)
    background = RippleDrawable(ColorStateList.valueOf(LearningColors.selected), rounded(Color.WHITE, LearningColors.border), rounded(Color.WHITE))
    setPadding(dp(12), dp(12), dp(12), dp(12))
    minimumWidth = dp(48)
    minimumHeight = dp(48)
    layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
    setOnClickListener { onClick() }
}
fun Context.divider() = View(this).apply {
    setBackgroundColor(LearningColors.border)
    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)).apply { topMargin = dp(8); bottomMargin = dp(8) }
}
fun formatTime(positionMs: Long): String {
    val seconds = positionMs.coerceAtLeast(0) / 1000
    return String.format(Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60)
}
fun Lesson.localizedTitle(context: Context) = if (ConfigurationCompat.getLocales(context.resources.configuration)[0]?.language == "ja") titleJa else title
fun Course.localizedTitle(context: Context) = if (ConfigurationCompat.getLocales(context.resources.configuration)[0]?.language == "ja") titleJa else title
