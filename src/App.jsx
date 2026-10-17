import { useState, useEffect, useCallback } from 'react'
import { computeSummary } from './domain/summary'
import { evaluateCatState } from './domain/catState'
import * as api from './utils/api'
import { clearSession, getToken, setSession } from './utils/authStorage'
import { AuthScreen } from './components/AuthScreen'
import { HomeView } from './views/HomeView'
import { InsightsView } from './views/InsightsView'
import { ReceiptView } from './views/ReceiptView'
import { SplitView } from './views/SplitView'
import { ProfileView } from './views/ProfileView'
import { TabBar } from './components/TabBar'
import { CharacterOnboarding } from './components/CharacterOnboarding'
import { hasSeenCharacterIntro } from './components/characterIntroState'
import { tokens } from './theme/tokens'

const CATEGORY_OPTIONS = {
  expense: [
    'food',
    'transport',
    'housing',
    'shopping',
    'entertainment',
    'education',
    'healthcare',
    'bills',
    'travel',
    'others',
  ],
  income: ['salary', 'freelance', 'bonus', 'gift', 'other_income'],
}

function toDateInputValue(date = new Date()) {
  const d = new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseDateInputToLocalDate(value) {
  const parts = String(value).trim().split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null
  const [y, m, d] = parts
  const when = new Date(y, m - 1, d, 12, 0, 0, 0)
  if (when.getFullYear() !== y || when.getMonth() !== m - 1 || when.getDate() !== d) return null
  return when
}

function formatTransactionDate(isoString) {
  try {
    const d = new Date(isoString)
    if (Number.isNaN(d.getTime())) return String(isoString)
    const pad = (n) => String(n).padStart(2, '0')
    return `${String(d.getFullYear()).slice(-2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  } catch {
    return String(isoString)
  }
}

const TABS = [
  { id: 'home', label: 'Home', emoji: '🏠' },
  { id: 'receipt', label: 'Receipt', emoji: '📷' },
  { id: 'insights', label: 'Insights', emoji: '📊' },
  { id: 'split', label: 'Split', emoji: '👥' },
]

function txId(tx) {
  return tx._id || tx.id
}

function isPublicSplitShare() {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('tab') === 'split' && params.get('share') === '1'
}

function App() {
  const [sessionReady, setSessionReady] = useState(false)
  const [oauthFlash, setOauthFlash] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showCharacterIntro, setShowCharacterIntro] = useState(false)
  const [tab, setTab] = useState(() => {
    if (typeof window === 'undefined') return 'home'
    const requestedTab = new URLSearchParams(window.location.search).get('tab')
    return TABS.some((item) => item.id === requestedTab) ? requestedTab : 'home'
  })
  const [transactions, setTransactions] = useState([])
  const [type, setType] = useState('expense')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(CATEGORY_OPTIONS.expense[0])
  const [txDateFrom, setTxDateFrom] = useState(() => toDateInputValue())
  const [txDateTo, setTxDateTo] = useState(() => toDateInputValue())
  const [weeklyBudget, setWeeklyBudget] = useState(300)
  const [petName, setPetName] = useState('Cookie')
  const [budgetInput, setBudgetInput] = useState('300')
  const [insightRange, setInsightRange] = useState('week')
  const [budgetError, setBudgetError] = useState('')
  const [transactionError, setTransactionError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [txs, settings] = await Promise.all([api.fetchTransactions(), api.fetchSettings()])
      setTransactions(txs)
      if (txs.length === 0 && !hasSeenCharacterIntro()) setShowCharacterIntro(true)
      setWeeklyBudget(settings.weeklyBudget || 300)
      setBudgetInput(String(settings.weeklyBudget || 300))
      setPetName(settings.petName || 'Cookie')
    } catch (err) {
      console.error('Failed to load from API:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    api.setAuthExpiredHandler(() => {
      setUser(null)
      setTransactions([])
    })
  }, [])

  const handleAuthSuccess = useCallback((u) => {
    setUser(u)
  }, [])

  const clearOauthFlash = useCallback(() => setOauthFlash(null), [])

  useEffect(() => {
    let cancelled = false
    async function bootstrapSession() {
      const hash = typeof window !== 'undefined' ? window.location.hash : ''
      if (hash.startsWith('#oauth=')) {
        const token = decodeURIComponent(hash.slice('#oauth='.length))
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        if (token && !cancelled) {
          setSession(token, { id: '', username: '' })
          try {
            const me = await api.fetchMe()
            if (!cancelled) {
              setSession(token, me)
              setUser(me)
            }
          } catch {
            clearSession()
            if (!cancelled) setUser(null)
          }
        }
        if (!cancelled) setSessionReady(true)
        return
      }
      if (hash.startsWith('#oauth_error=')) {
        const msg = decodeURIComponent(hash.slice('#oauth_error='.length))
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        if (!cancelled) setOauthFlash(msg)
        if (!cancelled) setSessionReady(true)
        return
      }
      const token = getToken()
      if (!token) {
        if (!cancelled) setSessionReady(true)
        return
      }
      try {
        const me = await api.fetchMe()
        if (!cancelled) setUser(me)
      } catch {
        clearSession()
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setSessionReady(true)
      }
    }
    bootstrapSession()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!sessionReady || !user) return
    reload()
  }, [sessionReady, user, reload])

  function handleLogout() {
    clearSession()
    setUser(null)
    setTransactions([])
    setWeeklyBudget(300)
    setPetName('Cookie')
    setBudgetInput('300')
    setShowCharacterIntro(false)
    setTab('home')
  }

  const weeklySummary = computeSummary(transactions, { range: 'week', weeklyBudget })
  const monthlySummary = computeSummary(transactions, { range: 'month', weeklyBudget })
  const catState = evaluateCatState({ summary: weeklySummary, transactions, weeklyBudget })

  function handleTypeChange(nextType) {
    setType(nextType)
    setCategory(CATEGORY_OPTIONS[nextType][0])
  }

  async function handleAddTransaction(event) {
    event.preventDefault()
    const trimmed = String(amount).trim()
    if (!trimmed) { setTransactionError('Please enter an amount.'); return }
    const parsedAmount = Number(trimmed)
    if (!Number.isFinite(parsedAmount)) { setTransactionError('Please enter a valid number.'); return }
    if (parsedAmount <= 0) { setTransactionError('Amount must be greater than zero.'); return }
    if (parsedAmount > 99999) { setTransactionError('Amount cannot exceed 5 digits.'); return }
    if (!txDateFrom) { setTransactionError('Please select a date.'); return }
    const date = parseDateInputToLocalDate(txDateFrom)
    if (!date) { setTransactionError('Please select a valid date.'); return }

    setTransactionError('')
    const item = {
      title: title.trim() || category,
      description: description.trim(),
      type,
      amount: parsedAmount,
      category,
      date: date.toISOString(),
      source: 'manual',
    }
    try {
      const created = await api.createTransactions([item])
      setTransactions((prev) => [...created, ...prev])
    } catch (err) {
      setTransactionError(err.message)
      return
    }
    setAmount('')
    setTitle('')
    setDescription('')
    setTxDateFrom(toDateInputValue())
    setTxDateTo(toDateInputValue())
  }

  async function handleDeleteTransaction(id) {
    try {
      await api.deleteTransaction(id)
      setTransactions((prev) => prev.filter((tx) => txId(tx) !== id))
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  async function handleEditTransaction(id, fields) {
    try {
      const updated = await api.updateTransaction(id, fields)
      setTransactions((prev) => prev.map((tx) => (txId(tx) === id ? updated : tx)))
    } catch (err) {
      console.error('Update failed:', err)
    }
  }

  async function handleBudgetSubmit(event) {
    event.preventDefault()
    const trimmed = String(budgetInput).trim()
    if (!trimmed) { setBudgetError('Please enter a weekly budget.'); return }
    const parsedBudget = Number(trimmed)
    if (!Number.isFinite(parsedBudget)) { setBudgetError('Please enter a valid number.'); return }
    if (parsedBudget <= 0) { setBudgetError('Weekly budget must be greater than zero.'); return }
    if (parsedBudget > 99999) { setBudgetError('Weekly budget cannot exceed 5 digits.'); return }
    setBudgetError('')
    try {
      await api.updateSettings({ weeklyBudget: parsedBudget })
      setWeeklyBudget(parsedBudget)
    } catch (err) {
      setBudgetError(err.message)
    }
  }

  async function handleUpdateUsername(nextUsername) {
    const result = await api.updateProfile({ username: nextUsername })
    setSession(result.token, result.user)
    setUser(result.user)
  }

  async function handleUpdatePetName(nextPetName) {
    const settings = await api.updateSettings({ petName: nextPetName })
    setPetName(settings.petName || 'Cookie')
  }

  async function handleChangePassword(payload) {
    await api.changePassword(payload)
  }

  async function handleImportTransactions(items) {
    const created = []
    for (let i = 0; i < items.length; i += 200) {
      created.push(...(await api.createTransactions(items.slice(i, i + 200))))
    }
    setTransactions((prev) => [...created, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date)))
    return created.length
  }

  async function handleCreateSplitExpense(payload) {
    const cat = 'bills'
    const items = [{
      title: payload.billName,
      description: `Split between ${payload.participantCount} people`,
      type: 'expense',
      amount: Math.min(Number(payload.amount) || 0, 99999),
      category: cat,
      date: new Date().toISOString(),
      source: 'split',
    }]
    try {
      const created = await api.createTransactions(items)
      setTransactions((prev) => [...created, ...prev])
      setTab('home')
    } catch (err) {
      console.error('Split create failed:', err)
    }
  }

  async function handleCreateReceiptExpense(item) {
    const created = await api.createTransactions([item])
    setTransactions((prev) => [...created, ...prev])
    setTab('home')
  }

  const shell = { background: tokens.color.bg, minHeight: '100vh', color: tokens.color.text }
  const inner = {
    maxWidth: 480,
    margin: '0 auto',
    padding: '20px 16px 96px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }

  if (!sessionReady) {
    return (
      <div style={{ ...shell, display: 'grid', placeItems: 'center' }}>
        <p>Loading...</p>
      </div>
    )
  }

  if (isPublicSplitShare()) {
    return (
      <div style={shell}>
        <div style={{ ...inner, paddingTop: 28, paddingBottom: 28 }}>
          <SplitView shareOnly />
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: tokens.color.bg,
          color: tokens.color.text,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, margin: '0 auto', padding: '40px 24px 48px' }}>
          <AuthScreen
            onAuthenticated={handleAuthSuccess}
            flashError={oauthFlash}
            onClearFlash={clearOauthFlash}
          />
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ ...shell, display: 'grid', placeItems: 'center' }}>
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div style={shell}>
      {showCharacterIntro ? (
        <CharacterOnboarding onComplete={() => setShowCharacterIntro(false)} />
      ) : null}
      <div style={inner}>
        <header
          style={{
            marginBottom: 18,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>
              Pocket Cookie
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: tokens.color.subtext }}>
              Sweet spending habits, one cookie at a time
            </p>
          </div>
          <ProfileView
            user={user}
            petName={petName}
            onUpdateUsername={handleUpdateUsername}
            onUpdatePetName={handleUpdatePetName}
            onChangePassword={handleChangePassword}
            onImportTransactions={handleImportTransactions}
            categoryOptions={CATEGORY_OPTIONS}
            onLogout={handleLogout}
          />
        </header>
        <div key={tab} className="tab-content">
        {tab === 'home' && (
          <HomeView
            weeklySummary={weeklySummary}
            catState={catState}
            weeklyBudget={weeklyBudget}
            budgetInput={budgetInput}
            setBudgetInput={setBudgetInput}
            budgetError={budgetError}
            setBudgetError={setBudgetError}
            handleBudgetSubmit={handleBudgetSubmit}
            type={type}
            handleTypeChange={handleTypeChange}
            title={title}
            setTitle={setTitle}
            description={description}
            setDescription={setDescription}
            amount={amount}
            setAmount={setAmount}
            category={category}
            setCategory={setCategory}
            txDateFrom={txDateFrom}
            setTxDateFrom={setTxDateFrom}
            txDateTo={txDateTo}
            setTxDateTo={setTxDateTo}
            transactionError={transactionError}
            setTransactionError={setTransactionError}
            handleAddTransaction={handleAddTransaction}
            transactions={transactions}
            handleDeleteTransaction={handleDeleteTransaction}
            handleEditTransaction={handleEditTransaction}
            formatTransactionDate={formatTransactionDate}
            categoryOptions={CATEGORY_OPTIONS}
            user={user}
            petName={petName}
          />
        )}
        {tab === 'insights' && (
          <InsightsView
            transactions={transactions}
            weeklySummary={weeklySummary}
            monthlySummary={monthlySummary}
            insightRange={insightRange}
            setInsightRange={setInsightRange}
            weeklyBudget={weeklyBudget}
          />
        )}
        {tab === 'receipt' && (
          <ReceiptView
            onCreateReceiptExpense={handleCreateReceiptExpense}
            categoryOptions={CATEGORY_OPTIONS.expense}
          />
        )}
        {tab === 'split' && (
          <SplitView onCreateSplitExpense={handleCreateSplitExpense} />
        )}
        </div>
      </div>
      <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} />
    </div>
  )
}
export default App
