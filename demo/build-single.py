"""Bundle the demo into one self-contained HTML body (for embedding/hosting as a single file)."""
import pathlib, sys
d = pathlib.Path(__file__).parent
css, eng, app = (d / "styles.css").read_text(), (d / "engine.js").read_text(), (d / "app.js").read_text()
out = f'''<title>AI-POS Demo</title>
<meta name="description" content="Interactive demo of AI-POS, a property operating system for landlords and property managers in Ghana.">
<style>
{css}
</style>
<div class="ribbon no-print"><span><b>Interactive demo.</b> Fictional data, saved only in your browser. Try anything; nothing is sent anywhere.</span><button id="reset" type="button">Reset demo data</button></div>
<div id="app"></div>
<script>
{eng}
</script>
<script>
{app}
</script>
'''
dest = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else d / "dist" / "ai-pos-demo.html"
dest.parent.mkdir(parents=True, exist_ok=True); dest.write_text(out); print(dest, len(out))
