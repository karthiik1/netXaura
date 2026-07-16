import sys
from pathlib import Path

# Make `app` importable when running pytest from the backend/ dir.
sys.path.insert(0, str(Path(__file__).parent))
