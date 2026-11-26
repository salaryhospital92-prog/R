import { createRoot } from 'react-dom/client'
import Panel from './Panel.jsx'
import '../styles.css'

// لون رزق: أخضر الشعار
document.documentElement.style.setProperty('--brand', '#0a5c42')

createRoot(document.getElementById('root')).render(<Panel />)
