import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ColumnDragOverlay } from './column-drag-overlay'
import type { ColumnDragState } from './use-column-drag'

function snapshotTable(text = 'Số lượng'): HTMLTableElement {
  const table = document.createElement('table')
  const body = table.createTBody()
  body.insertRow().insertCell().textContent = text
  return table
}

function dragState(over: Partial<ColumnDragState> = {}): ColumnDragState {
  return {
    fromKey: 'qty',
    label: 'Số lượng',
    snapshot: snapshotTable(),
    overKey: 'price',
    side: 'before',
    x: 400,
    y: 300,
    geometry: {
      width: 120,
      top: 100,
      bottom: 500,
      ghostLeft: 370,
      fromLeft: 200,
      dropX: 360,
      overLeft: 360,
      overWidth: 140,
    },
    ...over,
  }
}

function layer(name: 'placeholder' | 'target' | 'ghost' | 'drop-line') {
  return document.body.querySelector<HTMLElement>(`[data-drag-layer="${name}"]`)
}

describe('ColumnDragOverlay', () => {
  it('bê bản sao thật của cột chứ không phải một cái nhãn', () => {
    render(<ColumnDragOverlay drag={dragState()} />)
    const ghost = layer('ghost')
    expect(ghost?.querySelector('table')).toBeInTheDocument()
    expect(ghost).toHaveTextContent('Số lượng')
  })

  it('bản sao rộng đúng bằng cột thật và bám chỗ đã nắm trên ô tiêu đề', () => {
    render(<ColumnDragOverlay drag={dragState()} />)
    const ghost = layer('ghost')
    expect(ghost?.style.width).toBe('120px')
    expect(ghost?.style.left).toBe('370px')
    expect(ghost?.style.top).toBe('100px')
  })

  it('bản sao cao ĐÚNG bằng bảng, không cụt ngang giữa chừng', () => {
    render(<ColumnDragOverlay drag={dragState()} />)
    // top=100, bottom=500 -> phải phủ trọn 400px, bằng ô trống và vạch thả.
    expect(layer('ghost')?.style.height).toBe('400px')
    expect(layer('placeholder')?.style.height).toBe('400px')
    expect(layer('drop-line')?.style.height).toBe('400px')
  })

  it('cột hẹp hơn ngưỡng vẫn có bản sao nhìn thấy được', () => {
    // Cột tick chọn chỉ ~28px: vẽ đúng bề rộng thật thì cái bóng gần như tàng hình.
    const base = dragState()
    render(<ColumnDragOverlay drag={dragState({ geometry: { ...base.geometry, width: 8 } })} />)
    expect(Number.parseFloat(layer('ghost')?.style.width ?? '0')).toBeGreaterThanOrEqual(44)
  })

  it('rơi về nhãn chữ khi không chụp được bản sao', () => {
    // Bảng rỗng / cột vừa bị gỡ khỏi DOM: vẫn phải thấy mình đang kéo cột nào.
    render(<ColumnDragOverlay drag={dragState({ snapshot: null })} />)
    expect(screen.getByText('Số lượng')).toBeInTheDocument()
    expect(layer('ghost')?.querySelector('table')).toBeNull()
  })

  it('để lại ô trống đúng chỗ cột vừa nhấc lên', () => {
    render(<ColumnDragOverlay drag={dragState()} />)
    expect(layer('placeholder')?.style.left).toBe('200px')
    expect(layer('placeholder')?.style.width).toBe('120px')
  })

  it('không tô sáng khi cột đích chính là cột đang kéo', () => {
    // Thả lại chỗ cũ: tô sáng lúc này chỉ gây nhiễu, thứ tự cột không đổi.
    render(<ColumnDragOverlay drag={dragState({ overKey: 'qty' })} />)
    expect(layer('target')).toBeNull()
  })

  it('không vẽ vạch thả khi con trỏ chưa trỏ vào cột nào', () => {
    const base = dragState()
    render(
      <ColumnDragOverlay
        drag={dragState({
          overKey: null,
          side: null,
          geometry: { ...base.geometry, dropX: null, overLeft: null, overWidth: null },
        })}
      />,
    )
    expect(layer('drop-line')).toBeNull()
    expect(layer('ghost')).toBeInTheDocument()
  })

  it('bảng cuộn khuất khỏi khung thì không vẽ gì', () => {
    // `bottom <= top` xảy ra khi khung cuộn đã trôi hết qua bảng; vẽ tiếp là để
    // lại một vệt mảnh lơ lửng ngoài bảng.
    const base = dragState()
    render(
      <ColumnDragOverlay
        drag={dragState({ geometry: { ...base.geometry, top: 500, bottom: 500 } })}
      />,
    )
    expect(layer('ghost')).toBeNull()
    expect(layer('drop-line')).toBeNull()
  })
})
