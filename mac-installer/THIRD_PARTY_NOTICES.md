# Third-party components

The complete installer includes unmodified runtime components needed by DSH Canvas Suite.

- CPython standalone distribution: Python Software Foundation License; build distribution from Astral `python-build-standalone`.
- rembg: MIT License.
- ISNet/DIS general-use ONNX model: distributed by the rembg project; upstream model and dataset terms remain applicable.
- VTracer: MIT License.
- ImageTracerJS: Unlicense.
- Pillow: HPND License.
- psd-tools: MIT License.
- pytesseract: Apache-2.0 License.
- NumPy, SciPy, scikit-image, OpenCV, ONNX Runtime and transitive Python wheels retain their own license metadata inside each runtime's `site-packages/*dist-info` directory.
- dsh-codex compatibility build: Apache-2.0 License; based on the declared upstream repository in its package metadata.

The installer does not include API keys, OAuth tokens, Adobe applications, user projects, chat records or generated images. DSH Desktop remains an unmodified, separately signed application bundle. Confirm the application's redistribution terms before public commercial distribution.
