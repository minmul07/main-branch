import { useEffect, useRef, useState } from 'react'
import { getProcessing, ProcessingRequestError, retryProcessing } from '../processingApi'
import type { DocumentProcessing } from '../processingApi'

export const PROCESSING_POLL_MS = 2000

const ERROR_MESSAGES: Record<string, string> = {
  original_missing: '원본 파일을 찾을 수 없습니다.',
  invalid_pdf: 'PDF를 읽을 수 없습니다.',
  processing_error: '처리 중 오류가 발생했습니다.',
  interrupted: '서버가 멈춰 처리가 중단되었습니다.',
  ocr_unavailable: '서버에서 OCR을 사용할 수 없습니다.',
  ocr_failed: '스캔 페이지 글자 인식(OCR)에 실패했습니다.',
}

type Props = {
  documentId: number
  filename: string
  // 대기·처리 중이던 작업이 완료되면 호출한다. 페이지 수 등 목록 정보를 다시 읽는 데 쓴다.
  onCompleted?: () => void
}

function DocumentProcessingStatus({ documentId, filename, onCompleted }: Props) {
  const [processing, setProcessing] = useState<DocumentProcessing | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [gone, setGone] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [check, setCheck] = useState(0)
  const completed = useRef(onCompleted)
  // 이 화면에서 대기·처리 중 상태를 본 적이 있을 때만 완료를 알린다. 재시도 후에도 유지한다.
  const sawRunning = useRef(false)
  useEffect(() => { completed.current = onCompleted }, [onCompleted])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const next = await getProcessing(documentId)
        if (!active) return
        setProcessing(next); setLoadError(false)
        if (next.status === 'pending' || next.status === 'processing') {
          sawRunning.current = true
          timer = setTimeout(load, PROCESSING_POLL_MS)
        } else if (next.status === 'completed' && sawRunning.current) {
          sawRunning.current = false
          completed.current?.()
        }
      } catch (error) {
        if (!active) return
        if (error instanceof ProcessingRequestError && error.status === 404) setGone(true)
        else setLoadError(true)
      }
    }
    load()
    return () => { active = false; clearTimeout(timer) }
  }, [documentId, check])

  async function retry() {
    if (retrying) return
    setRetrying(true); setRetryError(null)
    try {
      setProcessing(await retryProcessing(documentId))
      sawRunning.current = true
      setCheck((n) => n + 1)
    } catch (error) {
      const status = error instanceof ProcessingRequestError ? error.status : 0
      if (status === 409) setCheck((n) => n + 1) // 이미 다시 처리 중이면 현재 상태를 다시 읽는다.
      else if (status === 404) setGone(true)
      else setRetryError('다시 처리 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setRetrying(false)
    }
  }

  if (gone) return null
  if (loadError) {
    return (
      <div className="processing-status processing-error" role="alert">
        처리 상태를 불러오지 못했습니다.
        <button type="button" onClick={() => { setLoadError(false); setCheck((n) => n + 1) }}>다시 확인</button>
      </div>
    )
  }
  if (processing === null || processing.status === 'completed') return null
  if (processing.status === 'failed') {
    const reason = ERROR_MESSAGES[processing.error_code ?? ''] ?? '알 수 없는 오류가 발생했습니다.'
    return (
      <div className="processing-status processing-failed" role="alert">
        <span>처리 실패: {reason}</span>
        <button type="button" aria-label={`${filename} 다시 처리`} disabled={retrying} onClick={retry}>
          {retrying ? '요청 중...' : '다시 처리'}
        </button>
        {retryError && <small>{retryError}</small>}
      </div>
    )
  }
  return (
    <p className="processing-status" role="status">
      {processing.status === 'pending' ? '처리 대기 중' : '텍스트 추출·OCR 처리 중...'}
    </p>
  )
}

export default DocumentProcessingStatus
