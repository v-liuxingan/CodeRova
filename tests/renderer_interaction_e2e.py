"""Dense-graph gesture regression; no writes to live graph/layout storage."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("CALLGRAPH_TEST_URL", "http://127.0.0.1:4317")
BASELINE = os.environ.get("CALLGRAPH_RENDERER_BASELINE")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    if BASELINE:
        for name in ["svg-renderer.js", "edge-label-placer.js"]:
            page.route(f"**/js/renderers/{name}", lambda route, request, name=name: route.fulfill(
                content_type="text/javascript", body=(Path(BASELINE) / "public/js/renderers" / name).read_text(encoding="utf-8")))
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    setup = page.evaluate("""async () => {
        const {SvgRenderer} = await import('/js/renderers/svg-renderer.js');
        const {NarrativeLayout} = await import('/js/layouts/narrative-layout.js');
        const {GraphState} = await import('/js/graph-state.js');
        const ns = 'http://www.w3.org/2000/svg';
        const wrap = document.createElement('div'); wrap.className = 'canvas-wrap';
        wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--canvas)';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('width', '1440'); svg.setAttribute('height', '1000');
        wrap.append(svg); document.body.append(wrap);
        const graph = {root:'n0', nodes:[], edges:[]};
        const positions = {};
        for (let i=0; i<320; i++) {
            graph.nodes.push({id:`n${i}`, kind:'function', label:`handler_${i}`, role:`步骤 ${i}`,
                description:'处理请求并将结果传给后续步骤', file:'src/example.js', line:i+1});
            positions[`n${i}`] = {x:(i%8)*340, y:Math.floor(i/8)*220};
            if(i>=8) graph.edges.push({id:`e${i}`, from:`n${i-8}`, to:`n${i}`, kind:'direct', label:'处理结果'});
            if(i>=8 && i%8<7) graph.edges.push({id:`b${i}`, from:`n${i-7}`, to:`n${i}`, kind:'direct', label:'条件分支', flowKind:'branch'});
        }
        const state = new GraphState(graph, {positions:{vertical:positions}});
        const renderer = new SvgRenderer(svg, new NarrativeLayout());
        let saves=0;
        renderer.setCallbacks({onNodesMove: positions => {saves++; state.setNodePositions(positions); renderer.render(graph,state);}});
        const start=performance.now(); renderer.render(graph,state);
        const renderMs=performance.now()-start;
        renderer.setViewport({x:40,y:40,scale:1});
        const stats={edges:0,labels:0,frames:[],saves:()=>saves};
        for(const [method,counter] of [['updateEdgeView','edges'],['layoutEdgeLabels','labels']]){
            const original=renderer[method].bind(renderer);
            renderer[method]=(...args)=>{stats[counter]++; return original(...args);};
        }
        window.probe={renderer,state,svg,stats};
        return {nodes:graph.nodes.length,edges:graph.edges.length,renderMs};
    }""")
    node = page.locator('[data-node-id="n8"]')
    box = node.bounding_box()
    start_x, start_y = box["x"] + 30, box["y"] + 40
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    during = page.evaluate("""async ({x,y}) => {
        const {svg,stats,renderer}=window.probe;
        const initialLabel=renderer.edgeViews.get('e319').labelGroup.getAttribute('transform');
        // Multiple device events in each display frame must collapse to one update.
        for(let frame=0;frame<30;frame++){
            const start=performance.now();
            for(let event=0;event<10;event++) svg.dispatchEvent(new PointerEvent('pointermove',{
                bubbles:true,pointerId:1,clientX:x+frame+event/10,clientY:y+frame/2,buttons:1
            }));
            await new Promise(requestAnimationFrame);
            stats.frames.push(performance.now()-start);
        }
        return {edgeUpdates:stats.edges,labelLayouts:stats.labels,
            stationaryLabel:initialLabel===renderer.edgeViews.get('e319').labelGroup.getAttribute('transform'),
            frames:stats.frames};
    }""", {"x": start_x, "y": start_y})
    # Release without another animation frame: the last position must be committed.
    committed = page.evaluate("""({x,y}) => {
        const {svg,state,stats}=window.probe;
        svg.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:x+70,clientY:y+30}));
        return {position:state.getNodePositions().n8,saves:stats.saves()};
    }""", {"x": start_x, "y": start_y})
    page.mouse.up()
    if not BASELINE:
        assert during["labelLayouts"] == 0, during
        assert during["edgeUpdates"] <= 30 * 4, during
        assert during["stationaryLabel"], during
        assert committed == {"position": {"x": 70, "y": 250}, "saves": 1}, committed

        # A canceled group drag restores all members and never persists it.
        page.evaluate("""() => {const {state,renderer}=probe;
            state.selectedNodeIds=new Set(['n8','n9']); renderer.render(state.graph,state);
        }""")
        box = node.bounding_box()
        page.mouse.move(box["x"] + 30, box["y"] + 40)
        page.mouse.down()
        page.mouse.move(box["x"] + 60, box["y"] + 65)
        page.evaluate("""() => probe.svg.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1}))""")
        page.mouse.up()
        restored = page.evaluate("""() => ({saves:probe.stats.saves(),
            positions:['n8','n9'].map(id=>{const e=probe.renderer.nodeViews.get(id).entry;return {x:e.x,y:e.y};})})""")
        assert restored == {"saves": 1, "positions": [{"x": 70, "y": 250}, {"x": 340, "y": 220}]}, restored
        # Camera movement performs no edge routing/label work.
        before = page.evaluate("() => ({edges:probe.stats.edges,labels:probe.stats.labels})")
        page.mouse.move(20, 900)
        page.mouse.down()
        page.mouse.move(100, 850, steps=15)
        page.mouse.up()
        after = page.evaluate("() => ({edges:probe.stats.edges,labels:probe.stats.labels})")
        assert before == after, (before, after)
        # Keyboard/selection re-render reuses routes and keeps the camera.
        stable = page.evaluate("""() => {
            const {renderer,state}=probe; const geometry=renderer.edgeViews.get('e319').entry.geometry;
            const camera=renderer.getViewport(); state.select({type:'node',id:'n8'});
            renderer.render(state.getVisibleGraph(),state);
            return {sameGeometry:geometry===renderer.edgeViews.get('e319').entry.geometry,
                sameCamera:JSON.stringify(camera)===JSON.stringify(renderer.getViewport())};
        }""")
        assert all(stable.values()), stable
        # Replacing the graph while an event is queued must cancel that event.
        box = node.bounding_box()
        page.mouse.move(box["x"] + 30, box["y"] + 40)
        page.mouse.down()
        replaced = page.evaluate("""async () => {
            const {renderer,state,svg,stats}=probe;
            svg.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:900,clientY:600}));
            renderer.render(state.graph,state);
            const before=renderer.nodeViews.get('n8').group.getAttribute('transform');
            await new Promise(requestAnimationFrame);
            return {stable:before===renderer.nodeViews.get('n8').group.getAttribute('transform'),
                dragging:!!renderer.nodeDrag,saves:stats.saves()};
        }""")
        page.mouse.up()
        assert replaced == {"stable": True, "dragging": False, "saves": 1}, replaced
    assert not errors, errors
    frames = sorted(during.pop("frames"))
    print(json.dumps({"baseline": bool(BASELINE), **setup, **during,
                      "frameMedianMs": round(frames[len(frames)//2], 2),
                      "frameP95Ms": round(frames[int(len(frames)*.95)], 2)}, ensure_ascii=False))
    browser.close()
