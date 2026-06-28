import React from 'react';
import { Metadata } from 'next';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import LeaderboardClient from './LeaderboardClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Leaderboard | TAKE ONE Nexus',
  description: 'Top performers and elite creators in the TAKE ONE Nexus community.',
};

async function getLeaderboardData() {
  const users = await prisma.$queryRaw<any[]>`
    SELECT u.id, u.name, u.role, u.college, u.city, u.avatar_url, u.gender, u.credits,
           u.screen_name, u.display_preference, u.email_verified,
           COALESCE(AVG(r.rating), 0) as averageRating, COUNT(r.rating) as ratingCount
    FROM users u
    LEFT JOIN user_ratings r ON u.id = r.rated_user_id
    GROUP BY u.id
    ORDER BY averageRating DESC, ratingCount DESC, u.credits DESC
    LIMIT 50
  `;

  return users.map(u => ({
    id: Number(u.id),
    name: u.name,
    screen_name: u.screen_name,
    display_preference: u.display_preference,
    avatar_url: u.avatar_url,
    gender: u.gender,
    role: u.role,
    college: u.college,
    credits: Number(u.credits),
    email_verified: Boolean(u.email_verified),
    averageRating: u.averageRating ? parseFloat(parseFloat(u.averageRating).toFixed(1)) : 0.0,
    ratingCount: Number(u.ratingCount)
  }));
}

export default async function LeaderboardPage() {
  const initialUsers = await getLeaderboardData();
  const user = await getCurrentUser();
  
  const pusherConfig = {
    key: process.env.NEXT_PUBLIC_PUSHER_KEY || '',
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || ''
  };

  return (
    <>
      <header>
        <a href="/" className="logo">TAKE <span>ONE</span></a>
        <nav>
          <a href="/#explore">Discover Projects</a>
          <a href="/crew">Find Crew</a>
          <a href="/leaderboard" className="active">Leaderboard</a>
          <a href="/chat" className="nav-chat-link">Community</a>
          {(!user?.role || ['director', 'writer', 'producer'].includes(user.role.toLowerCase())) ? (
            <a href="/#upload">Share Your Script</a>
          ) : (
            <a href="/#explore">Workspace</a>
          )}
          <a href="/profile">Profile</a>
        </nav>
      </header>

      <LeaderboardClient 
        initialUsers={initialUsers} 
        pusherConfig={pusherConfig} 
      />

      <footer>
        <div className="footer-bottom">
          <p>2026 Take One — Leaderboard Signal v2.0</p>
          <p>Credits · Recognition · Growth</p>
        </div>
      </footer>
    </>
  );
}
