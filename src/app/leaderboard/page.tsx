import React from 'react';
import { Metadata } from 'next';
import prisma from '@/lib/prisma';
import LeaderboardClient from './LeaderboardClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Leaderboard | TAKE ONE Nexus',
  description: 'Top performers and elite creators in the TAKE ONE Nexus community.',
};

async function getLeaderboardData() {
  const users = await prisma.user.findMany({
    where: {
      credits: { gt: 0 }
    },
    orderBy: {
      credits: 'desc'
    },
    take: 50,
    select: {
      id: true,
      name: true,
      screen_name: true,
      display_preference: true,
      avatar_url: true,
      gender: true,
      role: true,
      college: true,
      credits: true
    }
  });

  return JSON.parse(JSON.stringify(users));
}

export default async function LeaderboardPage() {
  const initialUsers = await getLeaderboardData();
  
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
          <a href="/opportunities">Opportunities</a>
          <a href="/leaderboard" className="active">Leaderboard</a>
          <a href="/#upload">Share Your Script</a>
          <a href="/profile">Profile</a>
          <a href="/chat" className="nav-chat-link">Messages</a>
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
