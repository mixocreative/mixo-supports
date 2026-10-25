"""Compare an unsupported aligner with a supported binary STL of the same pose.

Requires numpy and scipy. Prints aggregate measurements only; never copies patient
geometry or source paths into its output. The input STL files remain unchanged.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree


STL_FACE = np.dtype([('normal', '<f4', (3,)), ('vertices', '<f4', (3, 3)), ('attribute', '<u2')])


def load_binary_stl(path: Path) -> np.ndarray:
    data = path.read_bytes()
    if len(data) < 84:
        raise ValueError('STL is too short')
    count = int.from_bytes(data[80:84], 'little')
    if len(data) != 84 + count * 50:
        raise ValueError('Expected a complete binary STL')
    return np.frombuffer(data, dtype=STL_FACE, count=count, offset=84)['vertices'].copy()


def _face_keys(triangles: np.ndarray, quantum: float) -> np.ndarray:
    quantized = np.rint(triangles / quantum).astype(np.int32)
    order = np.lexsort((quantized[:, :, 2], quantized[:, :, 1], quantized[:, :, 0]), axis=1)
    return np.take_along_axis(quantized, order[:, :, None], axis=1)


def match_reference_faces(reference: np.ndarray, supported: np.ndarray, lift: float,
                          quantum: float = 0.001) -> np.ndarray:
    """Winding/order-independent triangle match after lifting the reference in Z."""
    if not np.isfinite(lift) or quantum <= 0:
        raise ValueError('Lift and quantization must be finite and valid')
    shifted = supported.copy()
    shifted[:, :, 2] -= lift
    keys = {face.tobytes() for face in _face_keys(reference, quantum)}
    return np.fromiter((face.tobytes() in keys for face in _face_keys(shifted, quantum)),
                       dtype=bool, count=len(supported))


def connected_face_components(triangles: np.ndarray, quantum: float = 0.001) -> np.ndarray:
    """Join STL triangles only through shared quantized 3D vertices, not proximity."""
    if len(triangles) == 0:
        return np.empty(0, dtype=np.int32)
    points = np.rint(triangles / quantum).astype(np.int32).reshape(-1, 3)
    _, vertex_ids = np.unique(points, axis=0, return_inverse=True)
    parent = np.arange(len(triangles), dtype=np.int32)

    def root(face: int) -> int:
        while parent[face] != face:
            parent[face] = parent[parent[face]]
            face = int(parent[face])
        return face

    first_face: dict[int, int] = {}
    for face in range(len(triangles)):
        for vertex in vertex_ids[3 * face:3 * face + 3]:
            key = int(vertex)
            if key in first_face:
                parent[root(face)] = root(first_face[key])
            else:
                first_face[key] = face
    roots = np.fromiter((root(face) for face in range(len(triangles))), dtype=np.int32)
    return np.unique(roots, return_inverse=True)[1].astype(np.int32)


def _quantiles(values: list[float]) -> list[float]:
    if not values:
        return []
    return np.quantile(values, [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]).round(3).tolist()


def compare(reference: np.ndarray, supported: np.ndarray, lift: float) -> dict:
    matched = match_reference_faces(reference, supported, lift)
    extra = supported[~matched]
    if matched.mean() < 0.8:
        return {'kind': 'inconclusive', 'reason': 'models-do-not-match-in-this-pose',
                'matchedSupportedFaces': int(matched.sum()), 'supportedFaces': len(supported)}
    labels = connected_face_components(extra)
    shell_vertices = np.unique(np.rint(reference.reshape(-1, 3) * 1000).astype(np.int32), axis=0) / 1000
    shell_vertices[:, 2] += lift
    tree = cKDTree(shell_vertices)
    base_columns: list[np.ndarray] = []
    column_widths: list[float] = []
    all_reaching: list[dict] = []
    for component in range(int(labels.max()) + 1):
        faces = extra[labels == component]
        low, high = faces.min(axis=(0, 1)), faces.max(axis=(0, 1))
        if high[2] <= lift or high[2] - low[2] < 3 or len(faces) < 50:
            continue
        points = faces.reshape(-1, 3)
        top = points[points[:, 2] >= high[2] - 0.15].mean(axis=0)
        shell_gap = float(tree.query(top)[0])
        if shell_gap > 0.5:
            continue
        all_reaching.append({'faces': len(faces), 'lowZ': float(low[2]), 'highZ': float(high[2]),
                             'widthX': float(high[0] - low[0]), 'widthY': float(high[1] - low[1]),
                             'shellVertexGap': shell_gap})
        if low[2] <= 0.5:
            base_columns.append(top)
            if high[0] - low[0] <= 2 and high[1] - low[1] <= 2:
                column_widths.append(float((high[0] - low[0] + high[1] - low[1]) / 2))
    spacing: list[float] = []
    if len(base_columns) > 1:
        locations = np.asarray(base_columns)
        spacing = cKDTree(locations).query(locations, k=2)[0][:, 1].tolist()
    return {
        'kind': 'comparison', 'liftMm': round(lift, 4), 'referenceFaces': len(reference),
        'supportedFaces': len(supported), 'matchedShellFaces': int(matched.sum()),
        'unmatchedSupportedFaces': len(extra), 'unmatchedComponents': int(labels.max()) + 1,
        'baseToShellColumns': len(base_columns), 'otherShellReachingComponents': len(all_reaching) - len(base_columns),
        'straightColumnWidthMmQuantiles': _quantiles(column_widths),
        'baseColumnNearestNeighborMmQuantiles': _quantiles(spacing),
        'shellVertexGapMmQuantiles': _quantiles([entry['shellVertexGap'] for entry in all_reaching]),
        'limitations': 'Component top to nearest shell vertex is approximate; branch contacts and raft are not fully segmented.',
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aligner', type=Path, required=True)
    parser.add_argument('--supported', type=Path, required=True)
    parser.add_argument('--lift', type=float, help='Z lift in mm; default: difference in highest model Z')
    args = parser.parse_args()
    reference = load_binary_stl(args.aligner)
    supported = load_binary_stl(args.supported)
    lift = args.lift if args.lift is not None else float(supported[:, :, 2].max() - reference[:, :, 2].max())
    print(json.dumps(compare(reference, supported, lift), separators=(',', ':')))


if __name__ == '__main__':
    main()
