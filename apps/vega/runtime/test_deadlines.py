import json
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from driver import Ui


class Response:
    def __init__(self, on_read): self.on_read = on_read
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, limit):
        self.on_read()
        return json.dumps({'value': True}).encode()


class DeadlineTests(unittest.TestCase):
    def test_caps_the_actual_rpc_timeout_and_rejects_a_reply_after_the_attempt_budget(self):
        ui = Ui.__new__(Ui)
        ui.server, ui.deadline, ui.operation_deadline = 'http://127.0.0.1:4735', 1000, 102
        clock = [100.0]
        def late_read(): clock[0] = 103
        with patch('driver.time.monotonic', lambda: clock[0]), patch('driver.urllib.request.urlopen', return_value=Response(late_read)) as rpc:
            with self.assertRaises(RuntimeError): ui.request('GET', '/status')
        self.assertLessEqual(rpc.call_args.kwargs['timeout'], 2)

    def test_does_not_accept_a_true_observation_returned_after_its_deadline(self):
        ui = Ui.__new__(Ui)
        ui.deadline = 1000
        clock = [100.0]
        def late_tree():
            clock[0] += 31
            return ET.Element('root')
        ui.tree = late_tree
        with patch('driver.time.monotonic', lambda: clock[0]):
            with self.assertRaises(RuntimeError): ui.wait(lambda tree: True, 30)


if __name__ == '__main__': unittest.main()
