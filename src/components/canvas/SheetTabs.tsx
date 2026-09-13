import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCanvasManager } from '@/hooks/useCanvasManager'

/**
 * Pestañas de hojas, estilo planilla. Cada hoja es un lienzo aparte dentro del
 * mismo proyecto: solo la activa se ve, se edita y entra al G-code.
 */
export function SheetTabs() {
  const { t } = useTranslation('canvas')
  const sheets = useCanvasStore((s) => s.sheets)
  const activeSheetId = useCanvasStore((s) => s.activeSheetId)
  const elements = useCanvasStore((s) => s.elements)
  const renameSheet = useCanvasStore((s) => s.renameSheet)
  const cm = useCanvasManager()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  // Borrar pide confirmacion en dos pasos: el primer click arma, el segundo borra
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const countFor = (sheetId: string) =>
    elements.filter((el) => (el.sheetId ?? sheets[0]?.id) === sheetId).length

  const commitRename = () => {
    if (editingId && draftName.trim()) renameSheet(editingId, draftName.trim())
    setEditingId(null)
  }

  return (
    <div className="absolute bottom-7 left-0 right-0 z-10 flex items-center gap-1 px-2 py-1 bg-background/90 backdrop-blur-sm border-t text-xs overflow-x-auto">
      {sheets.map((sheet) => {
        const isActive = sheet.id === activeSheetId
        return (
          <div
            key={sheet.id}
            className={`group flex items-center gap-1 rounded-t px-2 py-1 cursor-pointer whitespace-nowrap border-b-2 ${
              isActive
                ? 'bg-background border-primary font-medium'
                : 'border-transparent text-muted-foreground hover:bg-muted/60'
            }`}
            onClick={() => cm.switchSheet(sheet.id)}
            onDoubleClick={() => {
              setEditingId(sheet.id)
              setDraftName(sheet.name)
            }}
            title={t('sheetRenameHint')}
          >
            {editingId === sheet.id ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setEditingId(null)
                  e.stopPropagation()
                }}
                className="w-24 bg-transparent border rounded px-1 text-xs"
              />
            ) : (
              <>
                <span>{sheet.name}</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {countFor(sheet.id)}
                </span>
              </>
            )}

            {sheets.length > 1 && editingId !== sheet.id && (
              <button
                className={`ml-0.5 rounded px-0.5 ${
                  pendingDelete === sheet.id
                    ? 'text-destructive font-medium'
                    : 'opacity-0 group-hover:opacity-60 hover:opacity-100'
                }`}
                title={t('sheetDelete')}
                onClick={(e) => {
                  e.stopPropagation()
                  if (pendingDelete === sheet.id) {
                    cm.deleteSheet(sheet.id)
                    setPendingDelete(null)
                  } else {
                    setPendingDelete(sheet.id)
                  }
                }}
                onBlur={() => setPendingDelete(null)}
              >
                {pendingDelete === sheet.id ? t('sheetConfirmDelete') : <X className="h-3 w-3" />}
              </button>
            )}
          </div>
        )
      })}

      <button
        className="flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted/60"
        title={t('sheetAdd')}
        onClick={() => cm.createSheet()}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  )
}
