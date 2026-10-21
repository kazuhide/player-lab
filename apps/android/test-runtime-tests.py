import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location("runtime_tests", Path(__file__).with_name("runtime-tests.py"))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class InstrumentationCompletionTest(unittest.TestCase):
    def output(self, status=0, tail="OK (1 test)\nINSTRUMENTATION_CODE: -1"):
        return ("INSTRUMENTATION_STATUS: class=com.playerlab.android.ExampleTest\n"
                "INSTRUMENTATION_STATUS: test=checksNativeState\n"
                "INSTRUMENTATION_STATUS_CODE: 1\n"
                "INSTRUMENTATION_STATUS: class=com.playerlab.android.ExampleTest\n"
                "INSTRUMENTATION_STATUS: test=checksNativeState\n"
                f"INSTRUMENTATION_STATUS_CODE: {status}\n{tail}\n")

    def test_completed_native_test_passes(self):
        result = runtime.instrumentation_result(self.output())
        self.assertEqual("PASS", result["result"])
        self.assertEqual("checksNativeState", result["tests"][0]["test"])

    def test_adb_success_does_not_hide_failed_or_ignored_test(self):
        for status in (-2, -3):
            with self.subTest(status=status):
                self.assertEqual("FAIL", runtime.instrumentation_result(self.output(status))["result"])

    def test_partial_runner_and_zero_test_runs_fail(self):
        for output in (self.output(tail=""), "OK (0 tests)\nINSTRUMENTATION_CODE: -1\n"):
            with self.subTest(output=output):
                self.assertEqual("FAIL", runtime.instrumentation_result(output)["result"])

    def test_final_count_must_match_individual_results(self):
        self.assertEqual("FAIL", runtime.instrumentation_result(
            self.output(tail="OK (2 tests)\nINSTRUMENTATION_CODE: -1"))["result"])


if __name__ == "__main__":
    unittest.main()
