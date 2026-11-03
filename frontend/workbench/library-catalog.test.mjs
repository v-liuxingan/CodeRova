import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryProjects} from '../../public/js/library-catalog.js';
test('home and workbench share hidden-empty, restored graph, empty group and unregistered graph membership',()=>{
 const names=new Map([['visible','Visible'],['removed','Removed'],['restored','Restored'],['grouped','Grouped']]);
 const graphs=[{projectId:'restored'},{projectId:'uncatalogued'}];
 const projects=libraryProjects(names,graphs,[{project:'grouped',id:'empty'}],['removed','restored','grouped']);
 assert.deepEqual([...projects.keys()],['visible','restored','grouped','uncatalogued']);
 assert.equal(names.size,4);
});
