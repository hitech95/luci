'use strict';
'require view';
'require dom';
'require ui';
'require form';
'require network';
'require firewall';
'require tools.widgets as widgets';

network.registerPatternVirtual(/^map-.+$/);
network.registerErrorCode('INVALID_MAP_RULE', _('MAP rule is invalid'));
network.registerErrorCode('NO_MATCHING_PD',   _('No matching prefix delegation'));
network.registerErrorCode('UNSUPPORTED_TYPE', _('Unsupported MAP type'));

return network.registerProtocol('map', {
    getI18n: function() {
        return _('MAP / LW4over6');
    },

    getIfname: function() {
        return this._ubus('l3_device') || 'map-%s'.format(this.sid);
    },

    getOpkgPackage: function() {
        return 'map-t';
    },

    isFloating: function() {
        return true;
    },

    isVirtual: function() {
        return true;
    },

    getDevices: function() {
        return null;
    },

    containsDevice: function(ifname) {
        return (network.getIfnameOf(ifname) == this.getIfname());
    },

    _getMapData: function() {
        var d = this._ubus('data');

        if (L.isObject(d) && L.isObject(d.map)) {
            return d.map
        }

        return null;
    },

    _getBMRData: function() {
        var d = this._getMapData();

        if (d && typeof(d.bmr) === 'number' && L.isObject(d) &&
          Array.isArray(d.rule) && d.rule.length >= d.bmr) {
            return d.rule[d.bmr - 1];
        }

        return null;
    },

    _getMapRules: function() {
        var d = this._getMapData();

        if (d && Array.isArray(d.rule) && d.rule.length) {
            return d.rule;
        }

        return [];
    },

    _getMapType: function() {
        var d = this._getMapData();

        if (d && typeof(d["map-type"]) === 'string') {
            switch (d["map-type"]) {
                case 'map-e':
                    return 'MAP-E';
                case 'map-t':
                    return 'MAP-T';
                case 'lw4o6':
                    return 'LW4over6';
                default:
                    return _('Unknown');
            }
        }

        return _('Unknown');
    },

    _getMapRatio: function() {
        var d = this._getBMRData();

        if (d && "psid-len" in d)
            return Math.pow(2, d["psid-len"]);

        return -1;
    },

    getIPAddr: function() {
        var d = this._getBMRData();

        if (d && d["ipv4-address"]) {
            return d["ipv4-address"].address;
        }

        return null;
    },

    getIP6Addr: function() {
        var d = this._getBMRData();

        if (d && d["ipv6-address"]) {
            return d["ipv6-address"].address
        }

        return null;
    },

    _getBrAddr: function() {
        var d = this._getBMRData();

        if (d && d['dmr-addres']) {
            return '%s/%d'.format(d["dmr-addres"].address, d["dmr-addres"].mask);
        }

        return null;
    },

    _getPortRange: function() {
        var d = this._getBMRData();

        if (d && Array.isArray(d["port-set"])) {
            return d["port-set"];
        }

        return [];
    },

    getIPAddrs: function() {
        var d = this._getMapData();

        if (d && Array.isArray(d.rule) && d.rule.length) {
            var addrs = d.rule.map((rule) => rule["ipv4-address"])
              .map((addr) => '%s/%d'.format(addr.address, addr.mask));

            if (Array.isArray(addrs))
                return addrs;
        }

        return [];
    },

    _getZone: function() {
        return this.getZoneName() ? firewall.getZone(this.getZoneName()) :
          firewall.getZoneByNetwork(this.getName());
    },

    renderFormOptions: function(s) {
        var o;

        o = s.taboption('general', form.ListValue, 'maptype', _('Type'));
        o.value('map-e', 'MAP-E');
        o.value('map-t', 'MAP-T');
        o.value('lw4o6', 'LW4over6');

        o = s.taboption('general', form.Value, 'peeraddr', _('BR / DMR / AFTR'));
        o.rmempty = false;
        o.datatype = 'ip6addr';

        o = s.taboption('general', form.Value, 'ipaddr', _('IPv4 prefix'));
        o.datatype = 'ip4addr';

        o = s.taboption('general', form.Value, 'ip4prefixlen', _('IPv4 prefix length'), _('The length of the IPv4 prefix in bits, the remainder is used in the IPv6 addresses.'));
        o.placeholder = '32';
        o.datatype = 'range(0,32)';

        o = s.taboption('general', form.Value, 'ip6prefix', _('IPv6 prefix'), _('The IPv6 prefix assigned to the provider, usually ends with <code>::</code>'));
        o.rmempty = false;
        o.datatype = 'ip6addr';

        o = s.taboption('general', form.Value, 'ip6prefixlen', _('IPv6 prefix length'), _('The length of the IPv6 prefix in bits'));
        o.placeholder = '16';
        o.datatype = 'range(0,64)';

        o = s.taboption('general', form.Value, 'ealen', _('EA-bits length'));
        o.datatype = 'range(0,48)';

        o = s.taboption('general', form.Value, 'psidlen', _('PSID-bits length'));
        o.datatype = 'range(0,16)';

        o = s.taboption('general', form.Value, 'offset', _('PSID offset'));
        o.datatype = 'range(0,16)';

        o = s.taboption('advanced', widgets.NetworkSelect, 'tunlink', _('Tunnel Link'));
        o.nocreate = true;
        o.exclude = s.section;

        o = s.taboption('advanced', form.Value, 'ttl', _('Use TTL on tunnel interface'));
        o.placeholder = '64';
        o.datatype = 'range(1,255)';

        o = s.taboption('advanced', form.Value, 'mtu', _('Use MTU on tunnel interface'));
        o.placeholder = '1280';
        o.datatype = 'max(9200)';

        o = s.taboption('advanced', form.Flag, 'legacymap', _('Use legacy MAP'), _('Use legacy MAP interface identifier format (draft-ietf-softwire-map-00) instead of RFC7597'));
    },

    renderStatusModal: function() {
        return Promise.resolve(this.renderStatus(E('div'), true))
          .then(L.bind(function(nodes) {
            var modal = ui.showModal(_('Status') + ' » ' + this.getName(), [
                nodes,
                E('div', {
                    'class': 'right'
                }, [
                    E('button', {
                        'class': 'cbi-button cbi-button-neutral',
                        'click': function (ev) {
                            ui.hideModal();
                        }
                    }, _('Close')),
                ])
            ]);

            modal.style.maxWidth = '50%';
            modal.style.maxHeight = 'none';
        }, this)).catch(L.error);
    },

    renderPortList: function(node, items) {
        var children = [];

        for (var i = 0; i < items.length; i++) {
            children.push(E('span', {
                'class': 'ifacebadge',
                'style': 'min-width: 80px; max-width: 120px;'
            }, [
                items[i]
            ]));
        }

        dom.content(node, children);

        return node;
    },

    renderStatus: function(node, extended) {
        if (!extended) {
			var ratio = this._getMapRatio();

            ui.itemlist(node, [
                _('Type'), this._getMapType(),
                _('Shared IPv4'), this.getIPAddr(),
                _('Share Ratio'), ratio > 0 ? '1:%d'.format(ratio) : _('Unknown'),
                _('Port Set'), ratio > 1 ? E('a', {
                    href: '#',
                    click: L.bind(this.renderStatusModal, this)
                }, _('%d ranges').format(this._getPortRange().length)) : null
            ]);

            return node;
        } else {
            var dev = this.getL3Device() || this.getDevice();
            var type = dev ? dev.getType() : 'ethernet',
              up = dev ? dev.isUp() : false;

			var ratio = this._getMapRatio();


            var table = E('table', {
                'class': 'table rules',
            }, [
                E('tr', {
                    'class': 'tr table-titles'
                }, [
                    E('th', {
                        'class': 'th'
                    }, _('Index')),
                    E('th', {
                        'class': 'th'
                    }, _('Share Ratio')),
                    E('th', {
                        'class': 'th'
                    }, _('Shared IPv4')),
                    E('th', {
                        'class': 'th'
                    }, _('MAP IPv6 Address')),
                    E('th', {
                        'class': 'th'
                    }, _('BR / DMR / AFTR')),
                    E('th', {
                        'class': 'th'
                    }, _('IPv4 Prefix')),
                    E('th', {
                        'class': 'th'
                    }, _('IPv6 Prefix')),
                ])
            ]);


            cbi_update_table(table, this._getMapRules().map(L.bind(function(rule, idx) {
                var exp, rows;
                rows = [
                    '%d'.format(idx),
                    '1:%d'.format(Math.pow(2, rule["psid-len"])),
                    '%s'.format(rule["ipv4-address"].address),
                    '%s'.format(rule["ipv6-address"].address),
                    '%s/%d'.format(rule["dmr-addres"].address, rule["dmr-addres"].mask),
                    '%s/%d'.format(rule["ipv4-prefix"].address, rule["ipv4-prefix"].mask),
                    '%s/%d'.format(rule["ipv6-prefix"].address, rule["ipv6-prefix"].mask),
                ];

                return rows;
            }, this)), E('em', _('There are no rules')));


            dom.content(node, [
                E('div', {
                    'class': 'network-status-table'
                }, [
                    E('div', {
                        'class': 'ifacebox'
                    }, [
                        E('div', {
                              'class': 'ifacebox-head',
                              'style': 'background-color:#EEEEEE',
                              'title': _('No zone assigned')
                          },
                          E('strong', this.getName().toUpperCase())
                        ),
                        E('div', {
                            'class': 'ifacebox-body',
                        }, [
                            E('img', {
                                'src': L.resource('icons/%s%s.png').format(dev ? this.isAlias() ? 'alias' : type : 'ethernet_disabled', up ? '' : '_disabled'),
                                'style': 'width:16px; height:16px'
                            }),
                            E('br'),
                            ui.itemlist(E('span'), [
                                _('Type'), dev ? dev.getTypeI18n() : null,
                                _('Device'), this.isAlias() ? null : dev ? dev.getName() : _('Not present'),
                                _('Alias'), this.isAlias(),
                                _('Uplink'), this._getMapData()['link'].toUpperCase(),
                                _('Connected'), up ? _('yes') : _('no'),
                                _('MAC'), dev ? dev.getMAC() : null,
                                _('RX/TX'), dev ? '%.2mB (%d %s)'.format(dev.getRXBytes(), dev.getRXPackets(), _('Pkts.')) : null
                            ])
                        ])
                    ])
                ]),
                E('h4', _('Basic Mapping Rule')),
                E('div', {
                    'class': 'network-status-table'
                }, [
                    E('div', {
                        'class': 'ifacebox'
                    }, [
                        E('div', {
                            'class': 'ifacebox-body'
                        }, [
                            ui.itemlist(E('span'), [
                                _('Type'), this._getMapType(),
                                _('Shared IPv4'), this.getIPAddr(),
                                _('MAP IPv6'), this.getIP6Addr(),
                                _('BR / DMR / AFTR'), this._getBrAddr(),
                                _('Share Ratio'), ratio > 0 ? '1:%d'.format(ratio) : _('Unknown'),
                            ]),
                            ratio > 0 && E('h5', _('Port Sets')),
                            ratio > 0 && this.renderPortList(E('div'),
                              this._getPortRange().map((range) => '%s'.format(range))
                            )
                        ])
                    ])
                ]),

                E('h4', _('Forwarding Mapping Rules')),
                table,
            ]);

            this._getZone().then(L.bind(function(zone) {
                 this.style.backgroundColor = zone ? zone.getColor() : '#EEEEEE';
                 this.title = zone ? _('Part of zone %q').format(zone.getName()) : _('No zone assigned');
            }, node.childNodes[0].childNodes[0].childNodes[0]));

            return node;
        }
    }
});