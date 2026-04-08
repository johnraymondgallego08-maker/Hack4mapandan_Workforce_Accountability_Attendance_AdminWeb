exports.isAdmin = (req, res, next) => {
    const role = (req.session.user && req.session.user.role || '').toLowerCase();
    if (role === 'admin') {
        return next();
    }
    req.flash('error', 'You do not have permission to access this page.');
    res.redirect('/');
};