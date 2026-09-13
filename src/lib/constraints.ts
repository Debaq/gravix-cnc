// ============================================
// Geometric Constraints for Node Editing
// Applied during drag to restrict node movement
// ============================================
import type { Point2D } from './types'

export type ConstraintType = 'horizontal' | 'vertical' | 'fixed'

export interface NodeConstraint {
  id: string
  type: ConstraintType
  nodeIndex: number
  // For reference-based constraints
  referenceNodeIndex?: number
  referenceValue?: number
}

// Apply constraints to a proposed node position
// Returns the constrained position
export function applyConstraints(
  proposedX: number,
  proposedY: number,
  nodeIndex: number,
  constraints: NodeConstraint[],
  originalNodes: Point2D[],
): { x: number; y: number } {
  let x = proposedX
  let y = proposedY

  const nodeConstraints = constraints.filter(c => c.nodeIndex === nodeIndex)

  for (const c of nodeConstraints) {
    const orig = originalNodes[nodeIndex]
    if (!orig) continue

    switch (c.type) {
      case 'horizontal':
        // Lock Y — node can only move horizontally
        y = orig.y
        break
      case 'vertical':
        // Lock X — node can only move vertically
        x = orig.x
        break
      case 'fixed':
        // Node cannot move at all
        x = orig.x
        y = orig.y
        break
    }
  }

  return { x, y }
}

// Toggle a constraint on a node
export function toggleConstraint(
  constraints: NodeConstraint[],
  nodeIndex: number,
  type: ConstraintType,
): NodeConstraint[] {
  const existing = constraints.findIndex(c => c.nodeIndex === nodeIndex && c.type === type)
  if (existing >= 0) {
    // Remove
    return constraints.filter((_, i) => i !== existing)
  }
  // Add (remove other movement constraints on same node first)
  const filtered = constraints.filter(
    c => c.nodeIndex !== nodeIndex || (c.type !== 'horizontal' && c.type !== 'vertical' && c.type !== 'fixed')
  )
  return [...filtered, {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    type,
    nodeIndex,
  }]
}

// Render constraint indicator data for overlay drawing
export interface ConstraintIndicator {
  x: number
  y: number
  type: ConstraintType
}

export function getConstraintIndicators(
  constraints: NodeConstraint[],
  nodes: Point2D[],
): ConstraintIndicator[] {
  return constraints
    .filter(c => nodes[c.nodeIndex])
    .map(c => ({
      x: nodes[c.nodeIndex].x,
      y: nodes[c.nodeIndex].y,
      type: c.type,
    }))
}
