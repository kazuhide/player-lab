package com.playerlab.elearning

import android.view.KeyEvent
import android.view.View
import android.widget.RadioButton
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CourseSelectionTest : LearningPlaybackScenario() {
    @Test fun secondCourseBoundsPlaybackResumeAndLearnerSelection() {
        launch().use { scenario ->
            await(scenario, "Catalog did not load") { it.catalog != null && !it.progressLoading }
            lateinit var catalog: Catalog
            lateinit var first: Course
            lateinit var second: Course
            scenario.onActivity { activity ->
                val session = activity.sessionForTest()
                val lessons = requireNotNull(session.catalog).lessons
                first = Course("basics", "Basics", "Basics", lessons.take(2).map { it.id })
                second = Course("summary", "Summary", "Summary", listOf(lessons.last().id))
                catalog = Catalog(listOf(first, second), lessons)
                session.acceptCatalog(catalog)
                session.setCaptionDelivery(CaptionDelivery.MANIFEST)
                session.saveRequested(lessons.first(), 5_000, session.preferences)
            }
            await(scenario, "First course progress did not load") {
                it.courseId == first.id && !it.progressLoading && it.resumes.containsKey(first.lessonIds.first())
            }
            var useRemote = false
            scenario.onActivity { activity ->
                val root = activity.window.decorView
                assertNotNull(root.findViewWithTag<View>("continue"))
                val choice = requireNotNull(root.findViewWithTag<RadioButton>(second))
                useRemote = activity.isTelevision
                if (useRemote) assertTrue(choice.requestFocus()) else assertTrue(choice.performClick())
            }
            if (useRemote) InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            await(scenario, "Second course was not selected") { it.courseId == second.id }
            scenario.recreate()
            scenario.onActivity { activity ->
                val session = activity.sessionForTest()
                session.acceptCatalog(catalog)
                assertEquals(second.id, session.courseId)
                val root = activity.window.decorView
                assertNull(root.findViewWithTag<View>("continue"))
                assertNull(root.findViewWithTag<View>(CaptionDelivery.MANIFEST))
                assertEquals(CaptionDelivery.EXTERNAL, session.captionDelivery)
                assertNull(root.findViewWithTag<View>(first.lessonIds.first()))
                assertTrue(root.findViewWithTag<RadioButton>(second).isChecked)
                session.setAutoAdvance(true)
            }
            start(scenario, second.lessonIds.single(), autoAdvance = true)
            scenario.onActivity { activity ->
                val session = activity.sessionForTest()
                val source = session.player.source
                session.adjacent(-1)
                session.adjacent(1)
                assertSame(source, session.player.source)
                assertEquals(1, session.player.playlist.sources.size)
                session.returnToCourse()
                session.switchLearner(Learner.B)
                assertEquals(first.id, session.courseId)
                assertTrue(session.resumes.isEmpty())
                session.switchLearner(Learner.A)
                assertEquals(second.id, session.courseId)
            }
        }
    }
}
