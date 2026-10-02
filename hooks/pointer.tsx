import type { ClientModule } from 'claude-code'

// An invisible layer over the picture. It draws nothing, so the picture shows
// through, and tells the mod where the person clicks and where the pointer is.
const Pointer: ClientModule = (_props, surface) => {
  if (surface.state === undefined) {
    surface.setState(true)
    let moves = 0
    let lastColumn = -99
    surface.onPointer(event => {
      const column = event.fine?.x ?? event.x + 0.5
      if (event.type === 'down' && (event.button === 'left' || event.button === 'right')) {
        surface.post({ kind: 'down', button: event.button, x: event.x, y: event.y, fx: column })
      } else if (event.type === 'move' && event.button === undefined) {
        // hovering: report now and then, and only when the pointer has gone somewhere
        moves += 1
        if (moves % 5 === 0 && Math.abs(column - lastColumn) >= 1.5) {
          lastColumn = column
          surface.post({ kind: 'hover', x: event.x, y: event.y, fx: column })
        }
      }
    })
  }

  return surface.elements.Box({})
}

export default Pointer
