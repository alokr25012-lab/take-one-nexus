'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithCSRF } from '@/utils/fetchWithCSRF';

interface Issue {
  id: number;
  title: string;
  description: string;
  location: string | null;
  severity: string;
  screenshot: string | null;
  status: string;
  created_at: string;
  user: { id: number; name: string; email: string } | null;
}

export default function DeveloperIssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();

  const fetchIssues = async () => {
    try {
      const res = await fetch('/api/issues', {
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.status === 403) {
        setError('Access Denied. Admin Role Required.');
        return;
      }
      if (data.success) {
        setIssues(data.data);
      } else {
        setError(data.message || 'Failed to load issues');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIssues();
  }, []);

  const updateStatus = async (id: number, status: string) => {
    try {
      const res = await fetchWithCSRF(`/api/issues/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (data.success) {
        setIssues(issues.map(issue => issue.id === id ? { ...issue, status } : issue));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteIssue = async (id: number) => {
    if (!confirm('Are you sure you want to delete this issue?')) return;
    try {
      const res = await fetchWithCSRF(`/api/issues/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setIssues(issues.filter(issue => issue.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="p-8 text-white">Loading...</div>;

  if (error) return (
    <div className="p-8 text-white min-h-screen bg-black">
      <h1 className="text-4xl font-bebas text-red-500 mb-4">RESTRICTED ACCESS</h1>
      <p>{error}</p>
      <button onClick={() => router.push('/')} className="mt-4 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded">Return Home</button>
    </div>
  );

  return (
    <div className="p-8 text-white min-h-screen bg-black">
      <h1 className="text-4xl font-bebas mb-8 text-indigo-400">Developer Dashboard: Issues</h1>
      
      <div className="space-y-6">
        {issues.length === 0 ? (
          <p className="text-gray-400">No issues reported.</p>
        ) : (
          issues.map(issue => (
            <div key={issue.id} className="border border-gray-800 bg-gray-900 rounded p-6 shadow-md">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-bold font-bebas">{issue.title}</h2>
                  <div className="text-sm text-gray-400 mt-1">
                    Reported by: {issue.user ? `${issue.user.name} (${issue.user.email})` : 'Anonymous'} | 
                    Location: {issue.location || 'N/A'} | 
                    Date: {new Date(issue.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-2 py-1 text-xs uppercase font-bold rounded ${
                    issue.severity === 'high' ? 'bg-red-900 text-red-200' :
                    issue.severity === 'medium' ? 'bg-orange-900 text-orange-200' :
                    'bg-blue-900 text-blue-200'
                  }`}>
                    {issue.severity}
                  </span>
                  <select 
                    value={issue.status} 
                    onChange={(e) => updateStatus(issue.id, e.target.value)}
                    className={`text-sm px-2 py-1 rounded bg-black border ${
                      issue.status === 'open' ? 'border-red-500 text-red-500' :
                      issue.status === 'in-progress' ? 'border-yellow-500 text-yellow-500' :
                      'border-green-500 text-green-500'
                    }`}
                  >
                    <option value="open">Open</option>
                    <option value="in-progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>
              </div>
              
              <div className="bg-black p-4 rounded text-gray-300 mb-4 whitespace-pre-wrap font-mono text-sm">
                {issue.description}
              </div>
              
              {issue.screenshot && (
                <div className="mb-4">
                  <a href={issue.screenshot} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 text-sm">
                    View Screenshot &rarr;
                  </a>
                </div>
              )}

              <div className="flex justify-end mt-4">
                <button onClick={() => deleteIssue(issue.id)} className="text-red-500 hover:text-red-400 text-sm font-bold tracking-wider">
                  DELETE ISSUE
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
