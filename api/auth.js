export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body;
  const correctPassword = process.env.DASHBOARD_PASSWORD;

  if (!correctPassword) {
    console.error('DASHBOARD_PASSWORD not set in environment');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (password === correctPassword) {
    // Set auth cookie - expires in 7 days
    const maxAge = 60 * 60 * 24 * 7;
    const token = Buffer.from(`${Date.now()}-${correctPassword}`).toString('base64');
    
    res.setHeader('Set-Cookie', [
      `dash_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
    ]);
    
    return res.status(200).json({ success: true });
  }

  return res.status(401).json({ success: false, error: 'Invalid password' });
}
