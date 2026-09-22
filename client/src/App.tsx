import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type Category = 'Work' | 'Personal' | 'Ideas'
type Filter = 'all' | 'active' | 'completed'
type Section = 'tasks' | 'dashboard' | 'badges' | 'profile'
type Task = { _id: string; title: string; category: Category; due: string; completed: boolean }
type User = { id: string; name: string; email: string; streak: number; streakFreezeAvailable: boolean }
type AuthForm = { name: string; email: string; password: string }

const API_URL = 'http://localhost:5000/api'
const badgeList = [
  { icon: '✦', title: 'First step', text: 'Create your first task', earned: true },
  { icon: '7', title: 'On a roll', text: 'Keep a 7 day streak', earned: true },
  { icon: '◎', title: 'Finisher', text: 'Complete 25 tasks', earned: false },
  { icon: '◆', title: 'Deep focus', text: 'Complete 5 tasks in a day', earned: false },
]

async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || 'The request could not be completed.')
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('pace_token') || '')
  const [user, setUser] = useState<User | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register')
  const [authForm, setAuthForm] = useState<AuthForm>({ name: '', email: '', password: '' })
  const [tasks, setTasks] = useState<Task[]>([])
  const [newTask, setNewTask] = useState('')
  const [newCategory, setNewCategory] = useState<Category>('Personal')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [section, setSection] = useState<Section>('tasks')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [savedProfile, setSavedProfile] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    Promise.all([apiRequest<{ user: User }>('/me', {}, token), apiRequest<{ tasks: Task[] }>('/tasks', {}, token)])
      .then(([userResponse, taskResponse]) => { setUser(userResponse.user); setTasks(taskResponse.tasks) })
      .catch(() => { localStorage.removeItem('pace_token'); setToken('') })
  }, [token])

  const completedCount = tasks.filter((task) => task.completed).length
  const activeCount = tasks.length - completedCount
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const matchesFilter = filter === 'all' || (filter === 'active' ? !task.completed : task.completed)
    return matchesFilter && task.title.toLowerCase().includes(search.toLowerCase())
  }), [filter, search, tasks])

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    try {
      const response = await apiRequest<{ token: string; user: User }>(authMode === 'register' ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(authForm) })
      localStorage.setItem('pace_token', response.token); setToken(response.token); setUser(response.user)
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to authenticate.') }
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const title = newTask.trim(); if (!title) return
    try {
      const response = await apiRequest<{ task: Task }>('/tasks', { method: 'POST', body: JSON.stringify({ title, category: newCategory, due: 'Today' }) }, token)
      setTasks((current) => [response.task, ...current]); setNewTask('')
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to add task.') }
  }

  async function updateTask(id: string, updates: Partial<Task>) {
    try {
      const response = await apiRequest<{ task: Task }>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }, token)
      setTasks((current) => current.map((task) => task._id === id ? response.task : task))
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update task.') }
  }

  async function removeTask(id: string) {
    try { await apiRequest<void>(`/tasks/${id}`, { method: 'DELETE' }, token); setTasks((current) => current.filter((task) => task._id !== id)) }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to delete task.') }
  }

  async function logout() {
    await apiRequest<void>('/auth/logout', { method: 'POST' }, token).catch(() => undefined)
    localStorage.removeItem('pace_token'); setToken(''); setUser(null); setTasks([])
  }

  if (!user) return <AuthScreen authMode={authMode} authForm={authForm} error={error} onSubmit={submitAuth} onChange={setAuthForm} onSwitch={() => setAuthMode(authMode === 'register' ? 'login' : 'register')} />

  return <main className="app-shell"><header className="topbar"><button className="brand brand-button" type="button" onClick={() => setSection('tasks')}><span className="brand-mark">✓</span> P.A.C.E.</button><nav aria-label="Primary navigation">{(['tasks', 'dashboard', 'badges', 'profile'] as Section[]).map((item) => <button key={item} className={`nav-link ${section === item ? 'active' : ''}`} type="button" onClick={() => setSection(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav><button className="avatar" type="button" onClick={() => setSection('profile')} aria-label="Open profile">{user.name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</button></header><section className="dashboard">{error && <p className="error-message">{error}</p>}{section === 'tasks' && <TaskView tasks={tasks} visibleTasks={visibleTasks} completedCount={completedCount} newTask={newTask} setNewTask={setNewTask} newCategory={newCategory} setNewCategory={setNewCategory} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} updateTask={updateTask} removeTask={removeTask} editingId={editingId} setEditingId={setEditingId} editTitle={editTitle} setEditTitle={setEditTitle} addTask={addTask} />} {section === 'dashboard' && <Dashboard tasks={tasks} completedCount={completedCount} activeCount={activeCount} user={user} token={token} onUserChange={setUser} />} {section === 'badges' && <Badges completedCount={completedCount} />} {section === 'profile' && <Profile user={user} token={token} onUserChange={setUser} onLogout={logout} savedProfile={savedProfile} setSavedProfile={setSavedProfile} />}</section></main>
}

function AuthScreen({ authMode, authForm, error, onSubmit, onChange, onSwitch }: { authMode: 'login' | 'register'; authForm: AuthForm; error: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onChange: (form: AuthForm) => void; onSwitch: () => void }) {
  return <main className="auth-shell"><div className="auth-panel"><a className="brand auth-brand" href="/"><span className="brand-mark">✓</span> P.A.C.E.</a><div className="auth-copy"><p className="eyebrow">Personal momentum, made visible</p><h1>Plan your day.<br /><em>Move with purpose.</em></h1><p>One quiet place for the things you want to make happen.</p></div><form className="auth-form" onSubmit={onSubmit}>{authMode === 'register' && <label>Name<input required value={authForm.name} onChange={(event) => onChange({ ...authForm, name: event.target.value })} placeholder="Your name" /></label>}<label>Email<input required type="email" value={authForm.email} onChange={(event) => onChange({ ...authForm, email: event.target.value })} placeholder="you@example.com" /></label><label>Password<input required type="password" minLength={6} value={authForm.password} onChange={(event) => onChange({ ...authForm, password: event.target.value })} placeholder="At least 6 characters" /></label><button className="primary-button" type="submit">{authMode === 'register' ? 'Create my account' : 'Log in'} <span>↵</span></button>{error && <p className="error-message">{error}</p>}</form><p className="auth-switch">{authMode === 'register' ? 'Already have an account?' : 'New to P.A.C.E.?'} <button type="button" onClick={onSwitch}>{authMode === 'register' ? 'Log in' : 'Register'}</button></p></div><div className="auth-art"><span>“</span><p>Make space for what matters.</p><small>PLAN. ACT. COMPLETE. EVALUATE.</small></div></main>
}

function TaskView({ tasks, visibleTasks, completedCount, newTask, setNewTask, newCategory, setNewCategory, filter, setFilter, search, setSearch, updateTask, removeTask, editingId, setEditingId, editTitle, setEditTitle, addTask }: { tasks: Task[]; visibleTasks: Task[]; completedCount: number; newTask: string; setNewTask: (value: string) => void; newCategory: Category; setNewCategory: (value: Category) => void; filter: Filter; setFilter: (value: Filter) => void; search: string; setSearch: (value: string) => void; updateTask: (id: string, updates: Partial<Task>) => void; removeTask: (id: string) => void; editingId: string | null; setEditingId: (id: string | null) => void; editTitle: string; setEditTitle: (value: string) => void; addTask: (event: FormEvent<HTMLFormElement>) => void }) {
  return <><div className="intro-row"><div><p className="eyebrow">Thursday, 17 September 2026</p><h1>A clear mind starts<br /><em>with one small step.</em></h1></div><div className="progress-ring" aria-label={`${completedCount} of ${tasks.length} tasks completed`}><strong>{completedCount}/{tasks.length}</strong><span>done</span></div></div><form className="add-task" onSubmit={addTask}><span className="plus">+</span><input value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="What needs to be done?" aria-label="New task" /><select value={newCategory} onChange={(event) => setNewCategory(event.target.value as Category)} aria-label="Task category"><option>Personal</option><option>Work</option><option>Ideas</option></select><button type="submit">Add task <span>↵</span></button></form><div className="task-tools"><div className="filter-tabs" role="tablist">{(['all', 'active', 'completed'] as Filter[]).map((tab) => <button key={tab} className={filter === tab ? 'selected' : ''} type="button" role="tab" onClick={() => setFilter(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}</div><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" /><span className="task-count">{tasks.length} tasks</span></div><div className="task-list">{visibleTasks.length ? visibleTasks.map((task) => <article className={`task ${task.completed ? 'is-complete' : ''}`} key={task._id}><button className="check" type="button" onClick={() => updateTask(task._id, { completed: !task.completed })} aria-label={`Toggle ${task.title}`}>{task.completed ? '✓' : ''}</button>{editingId === task._id ? <input className="edit-input" autoFocus value={editTitle} onChange={(event) => setEditTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { updateTask(task._id, { title: editTitle.trim() }); setEditingId(null) } }} onBlur={() => { updateTask(task._id, { title: editTitle.trim() }); setEditingId(null) }} aria-label="Edit task" /> : <div className="task-copy"><h2>{task.title}</h2><div><span className={`tag ${task.category.toLowerCase()}`}>{task.category}</span><span className="due">{task.due}</span></div></div>}<button className="edit" type="button" onClick={() => { setEditingId(task._id); setEditTitle(task.title) }} aria-label={`Edit ${task.title}`}>✎</button><button className="delete" type="button" onClick={() => removeTask(task._id)} aria-label={`Delete ${task.title}`}>×</button></article>) : <div className="empty-state">Nothing here yet. Add a task to get moving.</div>}</div><p className="footer-note">Plan. Act. Complete. Evaluate</p></>
}

function Dashboard({ tasks, completedCount, activeCount, user, token, onUserChange }: { tasks: Task[]; completedCount: number; activeCount: number; user: User; token: string; onUserChange: (user: User) => void }) {
  async function freezeStreak() { if (!user.streakFreezeAvailable) return; const response = await apiRequest<{ streakFreezeAvailable: boolean }>('/dashboard/streak-freeze', { method: 'POST' }, token); onUserChange({ ...user, streakFreezeAvailable: response.streakFreezeAvailable }) }
  return <section className="content-section"><p className="eyebrow">Your rhythm</p><h1>Productivity,<br /><em>at a glance.</em></h1><div className="stats-grid"><div><strong>{user.streak}</strong><span>day streak</span></div><div><strong>{completedCount}</strong><span>completed</span></div><div><strong>{activeCount}</strong><span>in progress</span></div></div><div className="streak-panel"><div><span className="streak-flame">♨</span><div><h2>Protect your streak</h2><p>{user.streakFreezeAvailable ? 'You have one Streak Freeze available this week.' : 'Your Streak Freeze has been used this week.'}</p></div></div><button className="secondary-button" type="button" onClick={freezeStreak} disabled={!user.streakFreezeAvailable}>{user.streakFreezeAvailable ? 'Use freeze' : 'Protected'}</button></div><p className="muted-note">{tasks.length} total tasks are part of your current rhythm.</p></section>
}

function Badges({ completedCount }: { completedCount: number }) { return <section className="content-section"><p className="eyebrow">Your collection</p><h1>Little wins,<br /><em>worth noticing.</em></h1><p className="section-lead">Every completed task adds up. You have completed {completedCount} so far.</p><div className="badge-grid">{badgeList.map((badge) => <article className={`badge-card ${badge.earned ? 'earned' : ''}`} key={badge.title}><span className="badge-icon">{badge.icon}</span><h2>{badge.title}</h2><p>{badge.text}</p><small>{badge.earned ? 'Earned' : 'Locked'}</small></article>)}</div></section> }

function Profile({ user, token, onUserChange, onLogout, savedProfile, setSavedProfile }: { user: User; token: string; onUserChange: (user: User) => void; onLogout: () => void; savedProfile: boolean; setSavedProfile: (value: boolean) => void }) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  async function saveProfile(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const response = await apiRequest<{ user: User }>('/me', { method: 'PATCH', body: JSON.stringify({ name, email }) }, token); onUserChange(response.user); setSavedProfile(true) }
  return <section className="content-section"><p className="eyebrow">Your account</p><h1>Make it yours.</h1><form className="profile-form" onSubmit={saveProfile}><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button className="primary-button" type="submit">Save profile</button>{savedProfile && <p className="saved-message">Profile updated.</p>}</form><button className="logout-button" type="button" onClick={onLogout}>Log out</button></section>
}

export default App
