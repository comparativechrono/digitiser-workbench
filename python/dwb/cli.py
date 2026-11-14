"""Run the workbench's command-line programs by name.

    python -m dwb trace-digitiser figure.png --overlay

is the same as typing ``trace-digitiser figure.png --overlay`` on a computer where trace-digitiser is installed
with pip. The workbench's terminal uses this for its commands, and notebooks use it for ``!trace-digitiser ...``
lines.
"""
from __future__ import annotations

import importlib
import sys
from typing import Callable, Dict, List, Optional

# program name -> "module:function"
PROGRAMS: Dict[str, str] = {
    "trace-digitiser": "trace_digitiser.cli:main",
    "compare-known": "dwb.known:main",
}

# what each program is for, in a few words (for help and man in the terminal)
ABOUT: Dict[str, str] = {
    "trace-digitiser": "digitise a figure: lines (the default), points, bars, rows, heatmap, polar, describe",
    "compare-known": "compare what was digitised from one of the examples with the values it shows",
}

# The programs' packages need these of Pyodide's (the page loads them when Python starts)
NEEDS: Dict[str, List[str]] = {}
MODULES: Dict[str, str] = {}


def entry_point(name: str) -> Callable[[Optional[List[str]]], int]:
    if name not in PROGRAMS:
        raise KeyError(name)
    mod, func = PROGRAMS[name].split(":")
    return getattr(importlib.import_module(mod), func)


def _exit_status(code) -> int:
    if code is None:
        return 0
    if isinstance(code, bool):
        return int(code)
    if isinstance(code, int):
        return code
    print(code, file=sys.stderr)
    return 1


def run(argv: List[str]) -> int:
    """Run ``argv[0]`` (a program name) with the arguments ``argv[1:]`` and return its exit status, as a shell
    would. Nothing is raised: an error in the program is printed, as Python would print it, and gives status 1."""
    if not argv:
        print("usage: python -m dwb PROGRAM [ARGUMENTS ...]\nprograms: " + ", ".join(PROGRAMS), file=sys.stderr)
        return 2
    name, args = argv[0], list(argv[1:])
    if name not in PROGRAMS:
        print("dwb: no program called {!r} (there are: {})".format(name, ", ".join(PROGRAMS)), file=sys.stderr)
        return 127
    main = entry_point(name)
    old_argv = sys.argv[:]
    sys.argv[:] = [name] + args
    try:
        return _exit_status(main(args))
    except SystemExit as e:
        return _exit_status(e.code)
    except KeyboardInterrupt:
        return 130
    except Exception:  # noqa: BLE001 - show it as Python would, and carry on
        import traceback

        traceback.print_exc()
        return 1
    finally:
        sys.argv[:] = old_argv
        try:
            sys.stdout.flush()
        except Exception:  # noqa: BLE001
            pass


def main() -> None:
    sys.exit(run(sys.argv[1:]))


if __name__ == "__main__":
    main()
