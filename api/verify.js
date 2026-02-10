export default function handler(req, res) {
  const authCookie = req.cookies.dash_auth;
  
  if (!authCookie) {
    return res.status(401).json({ authenticated: false });
  }
  
  try {
    const decoded = Buffer.from(authCookie, 'base64').toString();
    const timestamp = parseInt(decoded.split('-')[0]);
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    if (Date.now() - timestamp > maxAge) {
      return res.status(401).json({ authenticated: false, reason: 'expired' });
    }
    
    return res.status(200).json({ authenticated: true });
  } catch (e) {
    return res.status(401).json({ authenticated: false, reason: 'invalid' });
  }
}
