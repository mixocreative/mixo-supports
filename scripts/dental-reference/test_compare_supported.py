import unittest

import numpy as np

from compare_supported import connected_face_components, match_reference_faces


class CompareSupportedTest(unittest.TestCase):
    def test_matches_reordered_shell_after_lift_but_not_extra_support(self):
        reference = np.array([
            [[0, 0, 0], [2, 0, 0], [0, 2, 0]],
            [[0, 0, 0], [0, 2, 0], [0, 0, 2]],
        ], dtype=np.float32)
        supported = np.array([
            [[0, 2, 3.5], [2, 0, 3.5], [0, 0, 3.5]],
            [[0, 0, 5.5], [0, 2, 3.5], [0, 0, 3.5]],
            [[4, 0, 0], [5, 0, 0], [4, 1, 0]],
        ], dtype=np.float32)
        self.assertEqual(match_reference_faces(reference, supported, 3.5).tolist(), [True, True, False])

    def test_components_connect_by_mesh_vertex_not_spatial_nearness(self):
        triangles = np.array([
            [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
            [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
            [[0.001, 0, 0.1], [1, 0, 0.1], [0, 1, 0.1]],
        ], dtype=np.float32)
        labels = connected_face_components(triangles)
        self.assertEqual(labels[0], labels[1])
        self.assertNotEqual(labels[0], labels[2])


if __name__ == '__main__':
    unittest.main()
