import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/app/bootstrap/app'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Không tìm thấy phần tử #root trong index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
