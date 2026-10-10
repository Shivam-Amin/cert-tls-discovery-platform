// Relationship map: nodes are host/process, endpoint, certificate and service;
// edges are the agent's relationships (communicates, presents, uses, serves).
// Drawn with Cytoscape in fixed columns, left to right:
//   host / process  →  endpoint  →  certificate (top) and service (bottom)
import { useEffect, useMemo, useRef } from 'react';
import cytoscape from 'cytoscape';
import { cssVar } from '../theme.js';
import { shortHash } from '../format.js';

const NODE_TYPES = ['host', 'process', 'endpoint', 'certificate', 'service'];
const COLUMN = { host: 0, process: 0, endpoint: 1, certificate: 2, service: 2 };
const COLUMN_GAP = 380;
const ROW_GAP = 64;

// Stacks the nodes of each column vertically, centred on y = 0.
function placeInColumns(nodes) {
  const columns = [[], [], []];
  for (const type of NODE_TYPES) {
    for (const node of nodes) if (node.data.type === type) columns[COLUMN[type]].push(node);
  }
  columns.forEach((column, x) => {
    column.forEach((node, i) => {
      node.position = { x: x * COLUMN_GAP, y: (i - (column.length - 1) / 2) * ROW_GAP };
    });
  });
}

// edges: relationship rows; certLabels: { fingerprint: "CN shown instead of hash" }
export default function RelationshipMap({ edges, certLabels = {} }) {
  const container = useRef(null);

  const elements = useMemo(() => {
    const nodes = new Map();
    const addNode = (type, id) => {
      const key = `${type}:${id}`;
      if (!nodes.has(key)) {
        const label = type === 'certificate' ? (certLabels[id] ?? shortHash(id)) : id;
        nodes.set(key, { data: { id: key, label, type, title: `${type}: ${id}` } });
      }
      return key;
    };
    const links = edges.map((e, i) => ({
      data: {
        id: `e${i}`,
        source: addNode(e.from_type, e.from_id),
        target: addNode(e.to_type, e.to_id),
        label: e.count > 1 ? `${e.edge} ×${e.count}` : e.edge,
        count: e.count,
      },
    }));
    placeInColumns([...nodes.values()]);
    return [...nodes.values(), ...links];
  }, [edges, certLabels]);

  useEffect(() => {
    if (!container.current || elements.length === 0) return undefined;
    const text = cssVar('--text');
    const edgeColor = cssVar('--graph-edge');
    const cy = cytoscape({
      container: container.current,
      elements,
      minZoom: 0.3,
      maxZoom: 2.5,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'font-size': 12,
            color: text,
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'text-max-width': 160,
            'text-wrap': 'ellipsis',
            width: 22,
            height: 22,
          },
        },
        ...NODE_TYPES.map((type) => ({
          selector: `node[type = "${type}"]`,
          style: { 'background-color': cssVar(`--node-${type}`) },
        })),
        { selector: 'node[type = "certificate"]', style: { shape: 'round-rectangle' } },
        { selector: 'node[type = "service"]', style: { shape: 'diamond' } },
        { selector: 'node[type = "host"], node[type = "process"]', style: { width: 30, height: 30 } },
        {
          selector: 'edge',
          style: {
            label: 'data(label)',
            'font-size': 9,
            color: cssVar('--text-muted'),
            'text-rotation': 'autorotate',
            'text-background-color': cssVar('--surface'),
            'text-background-opacity': 1,
            'text-background-padding': 1,
            'line-color': edgeColor,
            'target-arrow-color': edgeColor,
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            width: 'mapData(count, 1, 10, 1.5, 5)',
          },
        },
      ],
      layout: { name: 'preset', padding: 30 }, // positions from placeInColumns
    });
    // Hovering a node shows its full id (e.g. the whole fingerprint).
    cy.on('mouseover', 'node', (e) => (container.current.title = e.target.data('title')));
    cy.on('mouseout', 'node', () => (container.current.title = ''));
    return () => cy.destroy();
  }, [elements]);

  if (edges.length === 0) return <div className="chart-empty">No relationships in this run</div>;

  return (
    <>
      <div ref={container} className="graph" />
      <div className="legend">
        {NODE_TYPES.map((type) => (
          <span key={type}>
            <i style={{ background: `var(--node-${type})` }} />
            {type}
          </span>
        ))}
        <span>· arrow = direction · thicker line / ×N = seen on more connections · drag to move, scroll to zoom</span>
      </div>
    </>
  );
}
