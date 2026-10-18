#!/usr/bin/env python3
"""Exercise publication checks with temporary repositories and dummy values."""
from pathlib import Path
import os
import random
import string
import subprocess
import sys
import tempfile
import unittest

CHECKER = Path(__file__).with_name("check-publication.py").resolve()


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Publication test")
        self.git("config", "user.email", "test@example.invalid")
        self.write("README.md", "Public example\n")
        self.commit()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "Update fixture")

    def check(self, *args):
        env = {k: v for k, v in os.environ.items() if k != "PUBLICATION_PRIVATE_RULES"}
        return subprocess.run([sys.executable, str(CHECKER), *args], cwd=self.root,
                              env=env, capture_output=True, text=True)

    def test_blank_example_is_allowed(self):
        self.write(".env.example", "BITMOVIN_API_KEY=\n")
        self.commit()
        self.assertEqual(self.check().returncode, 0)

    def test_forced_env_is_rejected_even_after_deletion(self):
        self.write(".env", "PLACEHOLDER=\n")
        self.commit()
        (self.root / ".env").unlink()
        self.commit()
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("forbidden-file-in-history", result.stderr)

    def test_staged_generated_credentials_are_rejected(self):
        self.write("apps/ios/Local.xcconfig", "EMPTY=\n")
        self.git("add", "-A")
        self.assertEqual(self.check("--staged").returncode, 1)

    def test_secret_added_then_removed_is_rejected_without_echoing(self):
        rng = random.Random(7)
        secret = "ghp_" + "".join(rng.choices(string.ascii_letters + string.digits, k=36))
        self.write("settings.txt", "token=" + secret)
        self.commit()
        self.write("settings.txt", "token=\n")
        self.commit()
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("secret-pattern", result.stderr)
        self.assertNotIn(secret, result.stdout + result.stderr)

    def test_local_rules_detect_history_without_publishing_values(self):
        literal = "Private fixture phrase"
        rules = self.root / ".git" / "local-rules.txt"
        rules.write_text(literal)
        self.write("README.md", literal)
        self.commit()
        self.write("README.md", "Public fixture\n")
        self.commit()
        result = self.check("--private-rules", str(rules))
        self.assertEqual(result.returncode, 1)
        self.assertIn("private-local-history-rule", result.stderr)
        self.assertNotIn(literal, result.stdout + result.stderr)

    def test_tracked_private_rules_are_rejected(self):
        self.write("rules.txt", "Private fixture phrase")
        self.commit()
        self.assertEqual(self.check("--private-rules", str(self.root / "rules.txt")).returncode, 2)


if __name__ == "__main__":
    unittest.main()
