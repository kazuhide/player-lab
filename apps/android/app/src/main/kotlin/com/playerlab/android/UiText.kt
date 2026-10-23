package com.playerlab.android

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow

/** Localize presentation text without changing model keys, API names, code or SDK values. */
@Composable
internal fun uiText(text: String): String {
    LocalConfiguration.current
    val resources = LocalContext.current.resources
    return UiTextCatalog.resources[text]?.let(resources::getString) ?: text
}

@Composable
internal fun uiFormat(@StringRes resource: Int, vararg values: Any): String = stringResource(resource, *values)

/** A call receipt is app prose; an actual SDK return value is never translated. */
internal fun apiResultText(context: Context, value: Any?): String =
    if (value is Unit) context.getString(R.string.ui_command_submitted) else apiValue(value)

/** The layout and typography contract is the same as the existing Material text. */
@Composable
internal fun UiText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    fontFamily: FontFamily? = null,
    fontWeight: FontWeight? = null,
    overflow: TextOverflow = TextOverflow.Clip,
    softWrap: Boolean = true,
    maxLines: Int = Int.MAX_VALUE,
    style: TextStyle = LocalTextStyle.current,
) {
    Text(uiText(text), modifier = modifier, color = color, fontFamily = fontFamily,
        fontWeight = fontWeight, overflow = overflow, softWrap = softWrap, maxLines = maxLines, style = style)
}
