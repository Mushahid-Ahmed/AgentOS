'use client'

import {
	DOOR_VIEWBOX,
	DoorFrameArt,
	DoorLeafArt,
	doorSceneAnchors,
	type DoorPreset
} from '@/components/marketing/door-illustration'
import { MOTION_MS } from '@/lib/design-tokens'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'

// V16: the sign-in fly-through. When Supabase verifies the credentials, the door
// leaf swings open on its hinge and the camera dollies forward through the
// doorway until the light beyond fills the frame; the route change fires at that
// peak, so the swap to the app happens behind the light rather than as a cut.
//
// Three things decide the shape of it:
//
// 1. It is a real 3D scene, not a scale-up. `perspective` on the box plus
//    `preserve-3d` on the dolly means the leaf, which rotates about its hinge,
//    and the frame it passes behind, which does not, parallax against each other
//    the way two surfaces at different depths do.
// 2. The vanishing point sits in the DOORWAY, not at the illustration's centre
//    (`perspective-origin` / `transform-origin` both come from doorSceneAnchors).
//    A camera that grows about the middle of the drawing dives through the
//    closed panel; about the opening, it goes through the door.
// 3. It starts on top of the door it replaces. The caller measures the resting
//    illustration and passes that rect, so frame 0 is the door the visitor was
//    already looking at, in the same place, at the same size — the transition
//    reads as one object continuing to move, never as a second door appearing.
//
// The whole flight is CSS animation; the component holds no state and starts no
// timer. The form owns the wait (MOTION_MS.doorFly, which the CSS reads back as
// --dfs-ms so the two cannot drift) and reduced-motion users never mount this at
// all, so their redirect stays instant. The custom properties ride the root
// because the light layer is a sibling of the scene, and custom properties only
// inherit downward.

export type DoorRect = { top: number; left: number; width: number; height: number }

export function DoorFlythrough({ rect, preset }: { rect: DoorRect; preset: DoorPreset }) {
	// The scene's vanishing point is a share of the door box; the light beyond is
	// a full-screen layer, so it needs that same point in viewport pixels.
	const a = doorSceneAnchors(preset)
	const aim = `${a.aimXPercent}% ${a.aimYPercent}%`
	const aimX = rect.left + (rect.width * a.aimXPercent) / 100
	const aimY = rect.top + (rect.height * a.aimYPercent) / 100

	return createPortal(
		<div
			data-v16="fly-root"
			className="dfs-root"
			style={
				{
					'--dfs-ms': `${MOTION_MS.doorFly}ms`,
					'--dfs-hinge': `${a.hingeXPercent}%`,
					'--dfs-aim-x': `${aimX.toFixed(1)}px`,
					'--dfs-aim-y': `${aimY.toFixed(1)}px`
				} as CSSProperties
			}
		>
			<div
				data-v16="scene"
				className="dfs-scene"
				style={{
					top: rect.top,
					left: rect.left,
					width: rect.width,
					height: rect.height,
					perspectiveOrigin: aim
				}}
			>
				<div data-v16="dolly" className="dfs-dolly">
					<svg
						data-v16="frame"
						viewBox={DOOR_VIEWBOX}
						aria-hidden
						focusable="false"
						className="dfs-layer text-text"
						style={{ shapeRendering: 'geometricPrecision' }}
					>
						<DoorFrameArt preset={preset} />
					</svg>
					<svg
						data-v16="leaf"
						viewBox={DOOR_VIEWBOX}
						aria-hidden
						focusable="false"
						className="dfs-layer dfs-leaf text-text"
						style={{ shapeRendering: 'geometricPrecision' }}
					>
						<DoorLeafArt preset={preset} />
					</svg>
				</div>
			</div>
			{/* The light spilling out of the doorway: a full-viewport gradient whose
			    radius grows about the aim point, bright through the dive and gone at
			    its peak, so the flight lands on the interior's own near-black. */}
			<div data-v16="bloom" className="dfs-bloom" />
		</div>,
		document.body
	)
}
