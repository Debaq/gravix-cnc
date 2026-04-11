import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/useAppStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { HelpCircle, Keyboard, Mouse } from 'lucide-react'

export function HelpModal() {
  const { t } = useTranslation('common')
  const { activeModal, closeModal } = useAppStore()

  const isOpen = activeModal === 'help'

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            GRBL Web Control Pro v5.0
          </DialogTitle>
          <DialogDescription>Tauri + React + TypeScript</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[400px]">
          <div className="space-y-4 pr-4">
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Mouse className="h-4 w-4" />
                Canvas
              </h3>
              <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                <li>Scroll: Zoom in/out</li>
                <li>Click + Drag: Seleccionar/mover</li>
                <li>Middle click + Drag: Pan</li>
                <li>Shift + Click + Drag: Pan</li>
              </ul>
            </div>

            <Separator />

            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Keyboard className="h-4 w-4" />
                Workspaces
              </h3>
              <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                <li><strong>Diseno:</strong> Crear/editar elementos, cargar SVG</li>
                <li><strong>Preview:</strong> Visualizar G-code en 3D</li>
                <li><strong>Control:</strong> Conectar y controlar la maquina</li>
              </ul>
            </div>

            <Separator />

            <div>
              <h3 className="font-semibold text-sm">Flujo de trabajo</h3>
              <ol className="text-sm text-muted-foreground mt-1 space-y-1 list-decimal list-inside">
                <li>Configurar area de trabajo</li>
                <li>Cargar SVG o crear formas</li>
                <li>Configurar tipo de operacion y herramienta</li>
                <li>Generar G-code</li>
                <li>Previsualizar en 3D</li>
                <li>Conectar maquina y enviar</li>
              </ol>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
