"""The Digitiser workbench's own Python: what joins the web page to trace-digitiser.

``dwb.cli`` runs the programs by name (the terminal's ``trace-digitiser`` and ``compare-known``, and ``!`` lines in
notebooks), ``dwb.gui`` has the functions the Digitise tab calls (what is in a figure, digitising it with the choices
made on the page, the command line and the Python that do the same), and ``dwb.known`` compares what was digitised
from one of the examples with the values the figure shows.

None of this is needed to use trace-digitiser on your own computer: there you install it with pip
(``pip install trace-digitiser``) and call it directly.
"""

__version__ = "1.0.0"
