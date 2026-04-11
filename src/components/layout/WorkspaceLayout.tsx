import { Sidebar } from './Sidebar'

interface WorkspaceLayoutProps {
  children: React.ReactNode
}

export function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar />
      <main className="flex-1 relative overflow-hidden">
        {children}
      </main>
    </div>
  )
}
