import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './v1.2-performance.js'
import './v1.2-polish.css'
import './v1.3-stars.css'
import './v2-app.css'
import AppV2 from './AppV2.jsx'
import ProfileRequests from './ProfileRequests.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <>
      <AppV2 />
      <ProfileRequests />
    </>
  </StrictMode>,
)
