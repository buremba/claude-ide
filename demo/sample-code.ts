/**
 * Sample TypeScript code for code viewer demo
 */

interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
}

async function fetchUsers(): Promise<User[]> {
  const response = await fetch('/api/users');
  if (!response.ok) {
    throw new Error('Failed to fetch users');
  }
  return response.json();
}

function filterActiveUsers(users: User[]): User[] {
  return users.filter(user => user.role !== 'guest');
}

// Main entry point
export async function main() {
  try {
    const users = await fetchUsers();
    const activeUsers = filterActiveUsers(users);
    console.log(`Found ${activeUsers.length} active users`);
    return activeUsers;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}
