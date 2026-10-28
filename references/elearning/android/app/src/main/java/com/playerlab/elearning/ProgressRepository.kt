package com.playerlab.elearning

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ProgressRepository(context: Context) {
    private val preferences = context.getSharedPreferences("learning-progress", Context.MODE_PRIVATE)
    private val writer = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    suspend fun read(learner: Learner, lessonIds: List<String>): Map<String, ResumeRecord> = withContext(Dispatchers.IO) {
        lessonIds.mapNotNull { id ->
            preferences.getString("resume.${learner.name}.$id", null)?.let { ResumeCodec.decode(it, learner, id) }?.let { id to it }
        }.toMap()
    }

    fun save(record: ResumeRecord, result: (Boolean) -> Unit) {
        // The immutable record binds both identities before work leaves the main thread.
        writer.execute {
            val success = runCatching { preferences.edit().putString(record.storageKey, ResumeCodec.encode(record)).commit() }.getOrDefault(false)
            main.post { result(success) }
        }
    }

    fun close() { writer.shutdown() }
}
